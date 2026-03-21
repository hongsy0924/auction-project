/**
 * Cache operations for region signals, property scores, property analysis,
 * gosi match cache, and hot zone alerts.
 */
import {
    runAsync, getAsync, allAsync, getDb, ensureInitialized,
    SIGNAL_TTL, GOSI_TTL,
} from "./db";

// --- Region Signals Cache ---

export interface RegionSignal {
    council_code: string;
    dong_name: string;
    keyword: string;
    signal_summary: string | null;
    doc_ids: string | null;
    doc_count: number;
    last_updated: number;
}

export async function getRegionSignals(councilCode: string, dongName?: string): Promise<RegionSignal[]> {
    await ensureInitialized();
    const now = Date.now();

    if (dongName) {
        return allAsync<RegionSignal>(
            `SELECT * FROM region_signals WHERE council_code = ? AND dong_name = ? AND ? - last_updated <= ?`,
            [councilCode, dongName, now, SIGNAL_TTL]
        );
    }
    return allAsync<RegionSignal>(
        `SELECT * FROM region_signals WHERE council_code = ? AND ? - last_updated <= ?`,
        [councilCode, now, SIGNAL_TTL]
    );
}

export async function setRegionSignals(entries: {
    council_code: string;
    dong_name: string;
    keyword: string;
    signal_summary?: string;
    doc_ids?: string[];
    doc_count: number;
}[]): Promise<void> {
    await ensureInitialized();
    if (entries.length === 0) return;

    const now = Date.now();
    const d = getDb();

    return new Promise((resolve, reject) => {
        d.serialize(() => {
            d.run("BEGIN TRANSACTION");
            const stmt = d.prepare(
                `INSERT OR REPLACE INTO region_signals
                 (council_code, dong_name, keyword, signal_summary, doc_ids, doc_count, last_updated)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`
            );
            for (const e of entries) {
                stmt.run(
                    e.council_code,
                    e.dong_name,
                    e.keyword,
                    e.signal_summary || null,
                    e.doc_ids ? JSON.stringify(e.doc_ids) : null,
                    e.doc_count,
                    now
                );
            }
            stmt.finalize();
            d.run("COMMIT", (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    });
}

// --- Property Scores ---

export interface PropertyScore {
    doc_id: string;
    address: string;
    dong: string;
    pnu: string;
    sido: string;
    sigungu: string;
    score: number;
    signal_count: number;
    signal_keywords: string | null;
    facility_count: number;
    has_unexecuted: number;
    has_compensation: number;
    signal_details: string | null;
    facility_details: string | null;
    notice_count: number;
    permit_count: number;
    restriction_count: number;
    has_pnu_match: number;
    notice_details: string | null;
    permit_details: string | null;
    restriction_details: string | null;
    auction_data: string | null;
    batch_id: string;
    scored_at: number;
}

export type ScoreSortKey = "score" | "facility_age" | "gosi_stage" | "facility" | "compensation";

export interface ScoreQueryOptions {
    limit?: number;
    offset?: number;
    sort?: ScoreSortKey;
    filterCompensation?: boolean;
    excludeHousing?: boolean;
    filterFacility?: boolean;
    facilityType?: string;
    filterIncludeOnly?: boolean;
    filterUnexecutedOnly?: boolean;
}

function buildScoreQuery(opts: ScoreQueryOptions, countOnly: boolean): { sql: string; params: unknown[] } {
    const where: string[] = [];
    const params: unknown[] = [];

    if (opts.filterCompensation) {
        where.push("(has_compensation = 1 OR has_unexecuted = 1)");
    }

    if (opts.excludeHousing) {
        // Exclude all residential/building types — keep only land-oriented items
        where.push(`json_extract(auction_data, '$.물건종류') NOT IN ('다세대', '아파트', '오피스텔', '빌라')
            AND json_extract(auction_data, '$.물건종류') NOT LIKE '%주택%'`);
    }

    if (opts.filterFacility) {
        where.push(`(
            (json_extract(auction_data, '$.포함') IS NOT NULL AND json_extract(auction_data, '$.포함') != '')
            OR (json_extract(auction_data, '$.저촉') IS NOT NULL AND json_extract(auction_data, '$.저촉') != '')
        )`);
    }

    if (opts.facilityType) {
        // Reverse-map category name (e.g., "도로(소로)") to SQL keyword (e.g., "소로")
        const keyword = FACILITY_CATEGORY_KEYWORDS[opts.facilityType] || opts.facilityType;
        where.push(`(
            json_extract(auction_data, '$.포함') LIKE ?
            OR json_extract(auction_data, '$.저촉') LIKE ?
        )`);
        params.push(`%${keyword}%`, `%${keyword}%`);
    }

    if (opts.filterIncludeOnly) {
        where.push("(json_extract(auction_data, '$.포함') IS NOT NULL AND json_extract(auction_data, '$.포함') != '')");
    }

    if (opts.filterUnexecutedOnly) {
        where.push("has_unexecuted = 1");
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    if (countOnly) {
        return { sql: `SELECT COUNT(*) as cnt FROM property_scores ${whereClause}`, params };
    }

    // auction_data is JSON text — use json_extract for embedded fields
    let orderBy: string;
    switch (opts.sort) {
        case "facility_age":
            orderBy = "CAST(json_extract(auction_data, '$.시설경과연수') AS REAL) DESC, score DESC";
            break;
        case "gosi_stage":
            orderBy = "CAST(json_extract(auction_data, '$.gosi_stage') AS INTEGER) DESC, score DESC";
            break;
        case "facility":
            orderBy = "facility_count DESC, score DESC";
            break;
        case "compensation":
            orderBy = "(has_compensation + has_unexecuted) DESC, score DESC";
            break;
        default:
            orderBy = "score DESC";
    }

    params.push(opts.limit ?? 20, opts.offset ?? 0);
    return {
        sql: `SELECT * FROM property_scores ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
        params,
    };
}

export async function getPropertyScores(opts: ScoreQueryOptions = {}): Promise<PropertyScore[]> {
    await ensureInitialized();
    const { sql, params } = buildScoreQuery(opts, false);
    return allAsync<PropertyScore>(sql, params);
}

export async function getPropertyScoreCount(opts: ScoreQueryOptions = {}): Promise<number> {
    await ensureInitialized();
    const { sql, params } = buildScoreQuery(opts, true);
    const row = await getAsync<{ cnt: number }>(sql, params);
    return row?.cnt || 0;
}

export async function setPropertyScore(entry: Omit<PropertyScore, "scored_at">): Promise<void> {
    await ensureInitialized();
    await runAsync(
        `INSERT OR REPLACE INTO property_scores
         (doc_id, address, dong, pnu, sido, sigungu, score, signal_count,
          signal_keywords, facility_count, has_unexecuted, has_compensation,
          signal_details, facility_details,
          notice_count, permit_count, restriction_count, has_pnu_match,
          notice_details, permit_details, restriction_details,
          auction_data, batch_id, scored_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            entry.doc_id, entry.address, entry.dong, entry.pnu,
            entry.sido, entry.sigungu, entry.score, entry.signal_count,
            entry.signal_keywords, entry.facility_count,
            entry.has_unexecuted, entry.has_compensation,
            entry.signal_details, entry.facility_details,
            entry.notice_count, entry.permit_count, entry.restriction_count,
            entry.has_pnu_match,
            entry.notice_details, entry.permit_details, entry.restriction_details,
            entry.auction_data, entry.batch_id, Date.now(),
        ]
    );
}

export async function getPropertyScoreById(docId: string): Promise<PropertyScore | null> {
    await ensureInitialized();
    const row = await getAsync<PropertyScore>(
        "SELECT * FROM property_scores WHERE doc_id = ?",
        [docId]
    );
    return row || null;
}

export async function clearPropertyScores(excludeBatchId?: string): Promise<void> {
    await ensureInitialized();
    if (excludeBatchId) {
        // Delete old scores, keep the new batch
        await runAsync("DELETE FROM property_scores WHERE batch_id != ?", [excludeBatchId]);
    } else {
        await runAsync("DELETE FROM property_scores");
    }
}

import { classifyFacilityTerm, FACILITY_CATEGORY_KEYWORDS } from "@/lib/scoring/facility";

export async function getFacilityTypeCounts(): Promise<{ type: string; count: number }[]> {
    await ensureInitialized();

    const rows = await allAsync<{ pohaam: string | null; jeochok: string | null }>(
        `SELECT
            json_extract(auction_data, '$.포함') as pohaam,
            json_extract(auction_data, '$.저촉') as jeochok
         FROM property_scores
         WHERE (json_extract(auction_data, '$.포함') IS NOT NULL AND json_extract(auction_data, '$.포함') != '')
            OR (json_extract(auction_data, '$.저촉') IS NOT NULL AND json_extract(auction_data, '$.저촉') != '')`,
        []
    );

    const counts = new Map<string, number>();
    for (const row of rows) {
        const matched = new Set<string>();
        for (const val of [row.pohaam, row.jeochok]) {
            if (!val || !val.trim()) continue;
            const terms = val.split(",").map((s) => s.trim()).filter(Boolean);
            for (const term of terms) {
                const category = classifyFacilityTerm(term);
                if (category) matched.add(category);
            }
        }
        for (const cat of matched) {
            counts.set(cat, (counts.get(cat) || 0) + 1);
        }
    }

    return Array.from(counts.entries())
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count);
}

// --- Property Analysis ---

export interface PropertyAnalysis {
    doc_id: string;
    analysis_markdown: string;
    analyzed_at: number;
}

export async function getPropertyAnalysis(docId: string): Promise<PropertyAnalysis | null> {
    await ensureInitialized();
    const row = await getAsync<PropertyAnalysis>(
        "SELECT * FROM property_analysis WHERE doc_id = ?",
        [docId]
    );
    return row || null;
}

export async function setPropertyAnalysis(docId: string, markdown: string): Promise<void> {
    await ensureInitialized();
    await runAsync(
        "INSERT OR REPLACE INTO property_analysis (doc_id, analysis_markdown, analyzed_at) VALUES (?, ?, ?)",
        [docId, markdown, Date.now()]
    );
}

export async function getPropertyAnalysisBatch(docIds: string[]): Promise<Map<string, PropertyAnalysis>> {
    await ensureInitialized();
    const result = new Map<string, PropertyAnalysis>();
    if (docIds.length === 0) return result;

    const BATCH = 500;
    for (let i = 0; i < docIds.length; i += BATCH) {
        const batch = docIds.slice(i, i + BATCH);
        const placeholders = batch.map(() => "?").join(",");
        const rows = await allAsync<PropertyAnalysis>(
            `SELECT * FROM property_analysis WHERE doc_id IN (${placeholders})`,
            batch
        );
        for (const row of rows) {
            result.set(row.doc_id, row);
        }
    }
    return result;
}

// --- Gosi Match Cache ---

export interface CachedGosiMatch {
    doc_id: string;
    gosi_title: string;
    gosi_stage: number;
    ntc_date: string;
    match_type: string;
    area_cd: string;
    last_updated: number;
}

export async function getCachedGosiMatches(docId: string): Promise<CachedGosiMatch[]> {
    await ensureInitialized();
    const now = Date.now();
    return allAsync<CachedGosiMatch>(
        `SELECT * FROM gosi_match_cache WHERE doc_id = ? AND ? - last_updated <= ?`,
        [docId, now, GOSI_TTL]
    );
}

export async function setCachedGosiMatches(matches: CachedGosiMatch[]): Promise<void> {
    await ensureInitialized();
    if (matches.length === 0) return;
    const d = getDb();
    return new Promise((resolve, reject) => {
        d.serialize(() => {
            d.run("BEGIN TRANSACTION");
            const stmt = d.prepare(
                `INSERT OR REPLACE INTO gosi_match_cache
                 (doc_id, gosi_title, gosi_stage, ntc_date, match_type, area_cd, last_updated)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`
            );
            for (const m of matches) {
                stmt.run(m.doc_id, m.gosi_title, m.gosi_stage, m.ntc_date, m.match_type, m.area_cd, m.last_updated);
            }
            stmt.finalize();
            d.run("COMMIT", (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    });
}

// --- Hot Zone Alerts ---

export interface CachedHotZoneAlert {
    alert_id: string;
    zone_title: string;
    zone_stage: number;
    zone_area_cd: string;
    zone_dong_names: string;
    matched_doc_ids: string;
    created_at: number;
    reviewed: number;
}

export async function getHotZoneAlerts(): Promise<CachedHotZoneAlert[]> {
    await ensureInitialized();
    return allAsync<CachedHotZoneAlert>(
        `SELECT * FROM hot_zone_alerts WHERE reviewed = 0 ORDER BY created_at DESC LIMIT 50`
    );
}

export async function setHotZoneAlerts(alerts: CachedHotZoneAlert[]): Promise<void> {
    await ensureInitialized();
    if (alerts.length === 0) return;
    const d = getDb();
    return new Promise((resolve, reject) => {
        d.serialize(() => {
            d.run("BEGIN TRANSACTION");
            const stmt = d.prepare(
                `INSERT OR REPLACE INTO hot_zone_alerts
                 (alert_id, zone_title, zone_stage, zone_area_cd, zone_dong_names, matched_doc_ids, created_at, reviewed)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            );
            for (const a of alerts) {
                stmt.run(a.alert_id, a.zone_title, a.zone_stage, a.zone_area_cd, a.zone_dong_names, a.matched_doc_ids, a.created_at, a.reviewed);
            }
            stmt.finalize();
            d.run("COMMIT", (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    });
}

export async function markHotZoneReviewed(alertId: string): Promise<void> {
    await ensureInitialized();
    await runAsync("UPDATE hot_zone_alerts SET reviewed = 1 WHERE alert_id = ?", [alertId]);
}

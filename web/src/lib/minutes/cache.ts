/**
 * Persistent cache layer for minutes search pipeline.
 * Uses SQLite to cache CLIK API responses and Gemini embeddings.
 */
import sqlite3 from "sqlite3";
import path from "path";
import fs from "fs";
import crypto from "crypto";

const CACHE_DB_PATH = process.env.MINUTES_CACHE_PATH ||
    path.join(process.cwd(), "database/minutes_cache.db");

// TTL constants (milliseconds)
const SEARCH_TTL = 24 * 60 * 60 * 1000;   // 24 hours
const DETAIL_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days (historical data rarely changes)
const EMBEDDING_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
const SIGNAL_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const LURIS_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
const EUM_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const EUM_RESTRICTION_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

let db: sqlite3.Database | null = null;
let initialized = false;

function getDb(): sqlite3.Database {
    if (db) return db;

    const dir = path.dirname(CACHE_DB_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    db = new sqlite3.Database(CACHE_DB_PATH);
    return db;
}

function runAsync(sql: string, params: unknown[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
        getDb().run(sql, params, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function getAsync<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
        getDb().get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row as T | undefined);
        });
    });
}

function allAsync<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return new Promise((resolve, reject) => {
        getDb().all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve((rows || []) as T[]);
        });
    });
}

async function ensureInitialized(): Promise<void> {
    if (initialized) return;

    await runAsync(`CREATE TABLE IF NOT EXISTS search_cache (
        cache_key TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL
    )`);

    await runAsync(`CREATE TABLE IF NOT EXISTS detail_cache (
        docid TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL
    )`);

    await runAsync(`CREATE TABLE IF NOT EXISTS embedding_cache (
        chunk_hash TEXT PRIMARY KEY,
        embedding TEXT NOT NULL,
        created_at INTEGER NOT NULL
    )`);

    await runAsync(`CREATE TABLE IF NOT EXISTS region_signals (
        council_code TEXT NOT NULL,
        dong_name TEXT NOT NULL DEFAULT '',
        keyword TEXT NOT NULL,
        signal_summary TEXT,
        doc_ids TEXT,
        doc_count INTEGER DEFAULT 0,
        last_updated INTEGER NOT NULL,
        PRIMARY KEY (council_code, dong_name, keyword)
    )`);

    await runAsync(`CREATE TABLE IF NOT EXISTS luris_cache (
        pnu TEXT PRIMARY KEY,
        facilities TEXT,
        last_updated INTEGER NOT NULL
    )`);

    await runAsync(`CREATE TABLE IF NOT EXISTS eum_notices (
        area_cd TEXT PRIMARY KEY,
        notices TEXT NOT NULL,
        last_updated INTEGER NOT NULL
    )`);

    await runAsync(`CREATE TABLE IF NOT EXISTS eum_permits (
        area_cd TEXT PRIMARY KEY,
        permits TEXT NOT NULL,
        last_updated INTEGER NOT NULL
    )`);

    await runAsync(`CREATE TABLE IF NOT EXISTS eum_restrictions (
        area_cd TEXT PRIMARY KEY,
        restrictions TEXT NOT NULL,
        last_updated INTEGER NOT NULL
    )`);

    await runAsync(`CREATE TABLE IF NOT EXISTS property_scores (
        doc_id TEXT PRIMARY KEY,
        address TEXT NOT NULL,
        dong TEXT DEFAULT '',
        pnu TEXT DEFAULT '',
        sido TEXT DEFAULT '',
        sigungu TEXT DEFAULT '',
        score INTEGER NOT NULL DEFAULT 0,
        signal_count INTEGER DEFAULT 0,
        signal_keywords TEXT,
        facility_count INTEGER DEFAULT 0,
        has_unexecuted INTEGER DEFAULT 0,
        has_compensation INTEGER DEFAULT 0,
        signal_details TEXT,
        facility_details TEXT,
        notice_count INTEGER DEFAULT 0,
        permit_count INTEGER DEFAULT 0,
        restriction_count INTEGER DEFAULT 0,
        has_pnu_match INTEGER DEFAULT 0,
        notice_details TEXT,
        permit_details TEXT,
        restriction_details TEXT,
        auction_data TEXT,
        batch_id TEXT,
        scored_at INTEGER NOT NULL
    )`);

    await runAsync(`CREATE TABLE IF NOT EXISTS property_analysis (
        doc_id TEXT PRIMARY KEY,
        analysis_markdown TEXT NOT NULL,
        analyzed_at INTEGER NOT NULL
    )`);

    await runAsync(`CREATE TABLE IF NOT EXISTS gosi_match_cache (
        doc_id TEXT NOT NULL,
        gosi_title TEXT NOT NULL,
        gosi_stage INTEGER NOT NULL DEFAULT 0,
        ntc_date TEXT,
        match_type TEXT,
        area_cd TEXT,
        last_updated INTEGER NOT NULL,
        PRIMARY KEY (doc_id, gosi_title)
    )`);

    await runAsync(`CREATE TABLE IF NOT EXISTS hot_zone_alerts (
        alert_id TEXT PRIMARY KEY,
        zone_title TEXT NOT NULL,
        zone_stage INTEGER NOT NULL DEFAULT 0,
        zone_area_cd TEXT,
        zone_dong_names TEXT,
        matched_doc_ids TEXT,
        created_at INTEGER NOT NULL,
        reviewed INTEGER DEFAULT 0
    )`);

    initialized = true;
}

export function hashText(text: string): string {
    return crypto.createHash("sha256").update(text).digest("hex");
}

function makeCacheKey(keyword: string, councilCode?: string): string {
    return hashText(`${keyword}||${councilCode || ""}`);
}

// --- Search Cache ---

export async function getCachedSearch(keyword: string, councilCode?: string): Promise<unknown[] | null> {
    await ensureInitialized();
    const key = makeCacheKey(keyword, councilCode);
    const row = await getAsync<{ data: string; created_at: number }>(
        "SELECT data, created_at FROM search_cache WHERE cache_key = ?",
        [key]
    );
    if (!row) return null;
    if (Date.now() - row.created_at > SEARCH_TTL) {
        await runAsync("DELETE FROM search_cache WHERE cache_key = ?", [key]);
        return null;
    }
    return JSON.parse(row.data);
}

export async function setCachedSearch(keyword: string, councilCode: string | undefined, data: unknown[]): Promise<void> {
    await ensureInitialized();
    const key = makeCacheKey(keyword, councilCode);
    await runAsync(
        "INSERT OR REPLACE INTO search_cache (cache_key, data, created_at) VALUES (?, ?, ?)",
        [key, JSON.stringify(data), Date.now()]
    );
}

// --- Detail Cache ---

export async function getCachedDetail(docid: string): Promise<unknown | null> {
    await ensureInitialized();
    const row = await getAsync<{ data: string; created_at: number }>(
        "SELECT data, created_at FROM detail_cache WHERE docid = ?",
        [docid]
    );
    if (!row) return null;
    if (Date.now() - row.created_at > DETAIL_TTL) {
        await runAsync("DELETE FROM detail_cache WHERE docid = ?", [docid]);
        return null;
    }
    return JSON.parse(row.data);
}

export async function setCachedDetail(docid: string, data: unknown): Promise<void> {
    await ensureInitialized();
    await runAsync(
        "INSERT OR REPLACE INTO detail_cache (docid, data, created_at) VALUES (?, ?, ?)",
        [docid, JSON.stringify(data), Date.now()]
    );
}

// --- Embedding Cache ---

export async function getCachedEmbeddings(chunkHashes: string[]): Promise<Map<string, number[]>> {
    await ensureInitialized();
    const result = new Map<string, number[]>();
    if (chunkHashes.length === 0) return result;

    // Query in batches to avoid SQLite variable limit
    const BATCH = 500;
    for (let i = 0; i < chunkHashes.length; i += BATCH) {
        const batch = chunkHashes.slice(i, i + BATCH);
        const placeholders = batch.map(() => "?").join(",");
        const rows = await allAsync<{ chunk_hash: string; embedding: string; created_at: number }>(
            `SELECT chunk_hash, embedding, created_at FROM embedding_cache WHERE chunk_hash IN (${placeholders})`,
            batch
        );
        const now = Date.now();
        for (const row of rows) {
            if (now - row.created_at <= EMBEDDING_TTL) {
                result.set(row.chunk_hash, JSON.parse(row.embedding));
            }
        }
    }
    return result;
}

export async function setCachedEmbeddings(entries: { hash: string; embedding: number[] }[]): Promise<void> {
    await ensureInitialized();
    if (entries.length === 0) return;

    const now = Date.now();
    const d = getDb();

    return new Promise((resolve, reject) => {
        d.serialize(() => {
            d.run("BEGIN TRANSACTION");
            const stmt = d.prepare(
                "INSERT OR REPLACE INTO embedding_cache (chunk_hash, embedding, created_at) VALUES (?, ?, ?)"
            );
            for (const entry of entries) {
                stmt.run(entry.hash, JSON.stringify(entry.embedding), now);
            }
            stmt.finalize();
            d.run("COMMIT", (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    });
}

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

// --- LURIS Cache ---

export interface CachedLurisFacility {
    facilityName: string;
    facilityType: string;
    decisionDate?: string;
    executionStatus?: string;
}

export async function getCachedLuris(pnu: string): Promise<CachedLurisFacility[] | null> {
    await ensureInitialized();
    const row = await getAsync<{ facilities: string; last_updated: number }>(
        "SELECT facilities, last_updated FROM luris_cache WHERE pnu = ?",
        [pnu]
    );
    if (!row) return null;
    if (Date.now() - row.last_updated > LURIS_TTL) {
        await runAsync("DELETE FROM luris_cache WHERE pnu = ?", [pnu]);
        return null;
    }
    return JSON.parse(row.facilities);
}

export async function setCachedLuris(pnu: string, facilities: CachedLurisFacility[]): Promise<void> {
    await ensureInitialized();
    await runAsync(
        "INSERT OR REPLACE INTO luris_cache (pnu, facilities, last_updated) VALUES (?, ?, ?)",
        [pnu, JSON.stringify(facilities), Date.now()]
    );
}

// --- EUM Cache (토지이음) ---

export interface CachedEumNotice {
    title: string;
    noticeType: string;
    noticeDate: string;
    areaCd: string;
    relatedPnu?: string;
    relatedAddress?: string;
}

export interface CachedEumPermit {
    projectName: string;
    permitType: string;
    permitDate: string;
    areaCd: string;
    area?: string;
}

export interface CachedEumRestriction {
    zoneName: string;
    restrictionType: string;
    description: string;
    areaCd: string;
}

export async function getCachedEumNotices(areaCd: string): Promise<CachedEumNotice[] | null> {
    await ensureInitialized();
    const row = await getAsync<{ notices: string; last_updated: number }>(
        "SELECT notices, last_updated FROM eum_notices WHERE area_cd = ?",
        [areaCd]
    );
    if (!row) return null;
    if (Date.now() - row.last_updated > EUM_TTL) {
        await runAsync("DELETE FROM eum_notices WHERE area_cd = ?", [areaCd]);
        return null;
    }
    return JSON.parse(row.notices);
}

export async function setCachedEumNotices(areaCd: string, notices: CachedEumNotice[]): Promise<void> {
    await ensureInitialized();
    await runAsync(
        "INSERT OR REPLACE INTO eum_notices (area_cd, notices, last_updated) VALUES (?, ?, ?)",
        [areaCd, JSON.stringify(notices), Date.now()]
    );
}

export async function getCachedEumPermits(areaCd: string): Promise<CachedEumPermit[] | null> {
    await ensureInitialized();
    const row = await getAsync<{ permits: string; last_updated: number }>(
        "SELECT permits, last_updated FROM eum_permits WHERE area_cd = ?",
        [areaCd]
    );
    if (!row) return null;
    if (Date.now() - row.last_updated > EUM_TTL) {
        await runAsync("DELETE FROM eum_permits WHERE area_cd = ?", [areaCd]);
        return null;
    }
    return JSON.parse(row.permits);
}

export async function setCachedEumPermits(areaCd: string, permits: CachedEumPermit[]): Promise<void> {
    await ensureInitialized();
    await runAsync(
        "INSERT OR REPLACE INTO eum_permits (area_cd, permits, last_updated) VALUES (?, ?, ?)",
        [areaCd, JSON.stringify(permits), Date.now()]
    );
}

export async function getCachedEumRestrictions(areaCd: string): Promise<CachedEumRestriction[] | null> {
    await ensureInitialized();
    const row = await getAsync<{ restrictions: string; last_updated: number }>(
        "SELECT restrictions, last_updated FROM eum_restrictions WHERE area_cd = ?",
        [areaCd]
    );
    if (!row) return null;
    if (Date.now() - row.last_updated > EUM_RESTRICTION_TTL) {
        await runAsync("DELETE FROM eum_restrictions WHERE area_cd = ?", [areaCd]);
        return null;
    }
    return JSON.parse(row.restrictions);
}

export async function setCachedEumRestrictions(areaCd: string, restrictions: CachedEumRestriction[]): Promise<void> {
    await ensureInitialized();
    await runAsync(
        "INSERT OR REPLACE INTO eum_restrictions (area_cd, restrictions, last_updated) VALUES (?, ?, ?)",
        [areaCd, JSON.stringify(restrictions), Date.now()]
    );
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

export type ScoreSortKey = "score" | "price_ratio" | "facility_age" | "gosi_stage" | "facility" | "compensation";

export interface ScoreQueryOptions {
    limit?: number;
    offset?: number;
    sort?: ScoreSortKey;
    filterCompensation?: boolean;
    excludeHousing?: boolean;
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

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    if (countOnly) {
        return { sql: `SELECT COUNT(*) as cnt FROM property_scores ${whereClause}`, params };
    }

    // auction_data is JSON text — use json_extract for embedded fields
    let orderBy: string;
    switch (opts.sort) {
        case "price_ratio":
            orderBy = "CAST(json_extract(auction_data, '$.\"최저가/공시지가비율\"') AS REAL) ASC, score DESC";
            break;
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

export async function clearPropertyScores(): Promise<void> {
    await ensureInitialized();
    await runAsync("DELETE FROM property_scores");
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

// --- Cleanup ---

export async function cleanExpiredCache(): Promise<void> {
    await ensureInitialized();
    const now = Date.now();
    await runAsync("DELETE FROM search_cache WHERE ? - created_at > ?", [now, SEARCH_TTL]);
    await runAsync("DELETE FROM detail_cache WHERE ? - created_at > ?", [now, DETAIL_TTL]);
    await runAsync("DELETE FROM embedding_cache WHERE ? - created_at > ?", [now, EMBEDDING_TTL]);
    await runAsync("DELETE FROM region_signals WHERE ? - last_updated > ?", [now, SIGNAL_TTL]);
    await runAsync("DELETE FROM luris_cache WHERE ? - last_updated > ?", [now, LURIS_TTL]);
    await runAsync("DELETE FROM eum_notices WHERE ? - last_updated > ?", [now, EUM_TTL]);
    await runAsync("DELETE FROM eum_permits WHERE ? - last_updated > ?", [now, EUM_TTL]);
    await runAsync("DELETE FROM eum_restrictions WHERE ? - last_updated > ?", [now, EUM_RESTRICTION_TTL]);
}

const GOSI_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

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

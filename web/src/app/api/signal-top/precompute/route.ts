import { NextRequest } from "next/server";
import { getAllAuctionItems } from "@/lib/db";
import { resolveAddressToCouncils } from "@/lib/minutes/address-resolver";
import {
    getRegionSignals,
    setRegionSignals,
    setPropertyScore,
    clearPropertyScores,
    clearUpstreamCaches,
    getPropertyScores,
    type RegionSignal,
} from "@/lib/minutes/cache";
import { ClikClient } from "@/lib/minutes/clik-client";
import { getUrbanPlanFacilities, type UrbanPlanFacility } from "@/lib/luris/client";
import {
    getEumNotices,
    getEumDevPermits,
    getEumRestrictions,
    filterRelevantGosi,
    matchGosiToDong,
    extractHotZones,
} from "@/lib/eum/client";
import type { CachedEumNotice, CachedEumPermit, CachedEumRestriction } from "@/lib/minutes/cache";
import { scoreItem } from "@/lib/scoring/precompute";
import {
    setCachedGosiMatches,
    setHotZoneAlerts,
    type CachedGosiMatch,
} from "@/lib/minutes/cache";
import { reverseMatchHotZones } from "@/lib/eum/reverse-match";

const SIGNAL_KEYWORDS = ["보상", "편입", "수용", "개발", "착공", "도시계획", "도로", "택지"];

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
    const authHeader = request.headers.get("authorization");
    const secret = process.env.PRECOMPUTE_SECRET;
    if (!secret || authHeader !== `Bearer ${secret}`) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const forceRefresh = searchParams.get("refresh") === "true";

    const batchId = new Date().toISOString().slice(0, 10);

    // Respond immediately, process in background
    processAllItems(batchId, forceRefresh).catch((err) => {
        console.error("[Precompute] Fatal error:", err);
    });

    return Response.json({
        status: "started",
        batchId,
        message: "Pre-computation started in background",
    });
}

// computeScoreV2 is replaced by the scoring engine in @/lib/scoring/engine

// --- Fetch region signals (cache-first, then CLIK API) ---

async function fetchRegionSignals(
    clikClient: ClikClient,
    councilCode: string,
    dongName: string,
): Promise<RegionSignal[]> {
    const cached = await getRegionSignals(councilCode, dongName).catch(() => [] as RegionSignal[]);
    if (cached.length > 0) return cached;

    const entries: { council_code: string; dong_name: string; keyword: string; doc_ids: string[]; doc_count: number }[] = [];

    const results = await Promise.allSettled(
        SIGNAL_KEYWORDS.map(async (keyword) => {
            const searchTerm = dongName ? `${dongName} ${keyword}` : keyword;
            const { totalCount, items } = await clikClient.searchMinutes({
                keyword: searchTerm,
                councilCode,
                listCount: 10,
            });
            const docCount = Math.min(totalCount, items.length || totalCount);
            return { keyword, docCount, items };
        })
    );

    for (const result of results) {
        if (result.status === "fulfilled" && result.value.docCount > 0) {
            entries.push({
                council_code: councilCode,
                dong_name: dongName,
                keyword: result.value.keyword,
                doc_ids: result.value.items.map((item) => item.DOCID),
                doc_count: result.value.docCount,
            });
        }
    }

    if (entries.length > 0) {
        await setRegionSignals(entries).catch(() => {});
    }

    return entries.map((e) => ({
        council_code: e.council_code,
        dong_name: e.dong_name,
        keyword: e.keyword,
        signal_summary: null,
        doc_ids: JSON.stringify(e.doc_ids),
        doc_count: e.doc_count,
        last_updated: Date.now(),
    }));
}

// --- EUM pre-indexing ---

interface EumData {
    notices: CachedEumNotice[];
    permits: CachedEumPermit[];
    restrictions: CachedEumRestriction[];
}

async function preIndexEumData(areaCodes: string[]): Promise<Map<string, EumData>> {
    const eumCache = new Map<string, EumData>();
    console.log(`[Precompute] Pre-indexing EUM data for ${areaCodes.length} area codes...`);

    for (let i = 0; i < areaCodes.length; i++) {
        const areaCd = areaCodes[i];
        if (i > 0 && i % 20 === 0) {
            console.log(`[Precompute] EUM progress: ${i}/${areaCodes.length}`);
        }

        try {
            const [notices, permits, restrictions] = await Promise.all([
                getEumNotices(areaCd),
                getEumDevPermits(areaCd),
                getEumRestrictions(areaCd),
            ]);

            eumCache.set(areaCd, { notices, permits, restrictions });
        } catch (err) {
            console.error(`[Precompute] EUM error for ${areaCd}:`, err);
            eumCache.set(areaCd, { notices: [], permits: [], restrictions: [] });
        }

        // Rate limiting between API calls (skip if cache hit)
        if (i < areaCodes.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 300));
        }
    }

    console.log(`[Precompute] EUM pre-indexing complete: ${eumCache.size} area codes`);
    return eumCache;
}

// --- Background processing ---

async function processAllItems(batchId: string, forceRefresh: boolean = false) {
    console.log(`[Precompute] Starting batch ${batchId}`);

    if (forceRefresh) {
        console.log(`[Precompute] Refresh mode: clearing upstream caches...`);
        await clearUpstreamCaches();
        console.log(`[Precompute] Upstream caches cleared.`);
    }

    const clikApiKey = process.env.CLIK_API_KEY;
    if (!clikApiKey) {
        console.error("[Precompute] CLIK_API_KEY not set, cannot proceed");
        return;
    }
    const clikClient = new ClikClient(clikApiKey);

    let allItems: Record<string, unknown>[];
    try {
        allItems = await getAllAuctionItems();
    } catch (err) {
        console.error("[Precompute] Failed to load auction items:", err);
        return;
    }
    console.log(`[Precompute] Loaded ${allItems.length} auction items`);

    // Collect unique area codes (PNU first 5 digits) for EUM pre-indexing
    const areaCodeSet = new Set<string>();
    for (const item of allItems) {
        const pnu = String(item["PNU"] || "");
        if (pnu && pnu.length >= 5) {
            areaCodeSet.add(pnu.substring(0, 5));
        }
    }
    const areaCodes = [...areaCodeSet];
    console.log(`[Precompute] Found ${areaCodes.length} unique area codes`);

    // Pre-index EUM data (notices, permits, restrictions per area code)
    const eumCache = await preIndexEumData(areaCodes);

    // Hot zone detection from stage 3-4 gosi notices
    const allHotZones: import("@/lib/eum/client").HotZone[] = [];
    for (const [, eumData] of eumCache) {
        const zones = extractHotZones(eumData.notices);
        allHotZones.push(...zones);
    }
    console.log(`[Precompute] Found ${allHotZones.length} hot zones from stage 3-4 gosi`);

    // NOTE: We do NOT clear scores up front. Instead, we write all new scores
    // with the current batchId, then delete old scores at the end.
    // This ensures the UI always has data even if precompute crashes mid-run.
    console.log(`[Precompute] Starting scoring (batch=${batchId}). Old scores remain until complete.`);

    // Score all items
    const signalCache = new Map<string, RegionSignal[]>();
    let scoredCount = 0;
    let resolvedCount = 0;
    let dongCount = 0;

    for (let idx = 0; idx < allItems.length; idx++) {
        const item = allItems[idx];
        const address = String(item["주소"] || "");
        const pnu = String(item["PNU"] || "");
        const docId = String(item["고유키"] || "");
        if (!address || !docId) continue;

        // Exclude housing items from scoring
        const itemType = String(item["물건종류"] || "");
        if (itemType.includes("주택")) continue;

        if (idx < 3) {
            console.log(`[Precompute] Processing item ${idx}: address="${address.substring(0, 30)}..." pnu="${pnu}"`);
        }

        if (idx > 0 && idx % 100 === 0) {
            console.log(`[Precompute] Progress: ${idx}/${allItems.length} (resolved=${resolvedCount}, scored=${scoredCount}, regions=${signalCache.size})`);
        }

        try {
            const location = resolveAddressToCouncils(address);
            if (!location || location.councilCodes.length === 0) continue;
            resolvedCount++;
            if (location.dong) dongCount++;

            const primaryCouncil = location.councilCodes[0];
            const cacheKey = `${primaryCouncil.code}::${location.dong || ""}`;
            let signals = signalCache.get(cacheKey);
            if (!signals) {
                signals = await fetchRegionSignals(clikClient, primaryCouncil.code, location.dong || "");
                signalCache.set(cacheKey, signals);
            }
            const signalResults = signals.filter((s) => s.doc_count > 0);

            // LURIS facilities
            let facilities: UrbanPlanFacility[] = [];
            if (pnu) {
                try {
                    facilities = await getUrbanPlanFacilities(pnu);
                } catch { /* non-fatal */ }
            }

            // EUM data (pre-indexed by area code)
            const areaCd = pnu && pnu.length >= 5 ? pnu.substring(0, 5) : "";
            const eumData = areaCd ? eumCache.get(areaCd) : undefined;
            const notices = eumData?.notices || [];
            const permits = eumData?.permits || [];
            const restrictions = eumData?.restrictions || [];

            // Gosi matching for this property
            const relevantGosi = filterRelevantGosi(notices);
            const dongName = location.dong || String(item["동"] || "");
            const gosiMatches = matchGosiToDong(relevantGosi, dongName);
            const maxGosiStage = gosiMatches.length > 0
                ? Math.max(...gosiMatches.map((m) => m.gosiStage))
                : 0;

            // Cache gosi matches
            if (gosiMatches.length > 0) {
                const cacheable: CachedGosiMatch[] = gosiMatches.map((m) => ({
                    doc_id: docId,
                    gosi_title: m.notice.title,
                    gosi_stage: m.gosiStage,
                    ntc_date: m.notice.noticeDate,
                    match_type: m.matchType,
                    area_cd: m.notice.areaCd,
                    last_updated: Date.now(),
                }));
                setCachedGosiMatches(cacheable).catch(() => {});
            }

            // Scoring engine (extracted to lib/scoring/precompute.ts)
            const scoreResult = scoreItem(item, maxGosiStage);

            if (scoreResult.total === 0) continue;

            const hasCompensation = signalResults.some((s) =>
                ["보상", "수용", "편입"].includes(s.keyword)
            ) || maxGosiStage >= 3;
            const hasUnexecuted = facilities.some(
                (f) => f.executionStatus && f.executionStatus !== "집행완료"
            );

            scoredCount++;

            await setPropertyScore({
                doc_id: docId,
                address,
                dong: dongName,
                pnu,
                sido: location.sido,
                sigungu: location.sigungu,
                score: scoreResult.total,
                signal_count: signalResults.reduce((sum, s) => sum + s.doc_count, 0),
                signal_keywords: JSON.stringify([...new Set(signalResults.map((s) => s.keyword))]),
                facility_count: facilities.length,
                has_unexecuted: hasUnexecuted ? 1 : 0,
                has_compensation: hasCompensation ? 1 : 0,
                signal_details: JSON.stringify(
                    signalResults.map((s) => ({
                        keyword: s.keyword,
                        doc_count: s.doc_count,
                        signal_summary: s.signal_summary,
                        council_code: s.council_code,
                    }))
                ),
                facility_details: JSON.stringify(
                    facilities.map((f) => ({
                        facilityName: f.facilityName,
                        facilityType: f.facilityType,
                        executionStatus: f.executionStatus,
                    }))
                ),
                notice_count: notices.length,
                permit_count: permits.length,
                restriction_count: restrictions.length,
                has_pnu_match: notices.some((n) => n.relatedAddress && n.relatedAddress.length > 0) ? 1 : 0,
                notice_details: JSON.stringify(
                    notices.slice(0, 20).map((n) => ({
                        title: n.title,
                        noticeType: n.noticeType,
                        noticeDate: n.noticeDate,
                    }))
                ),
                permit_details: JSON.stringify(
                    permits.slice(0, 20).map((p) => ({
                        projectName: p.projectName,
                        permitType: p.permitType,
                        permitDate: p.permitDate,
                        area: p.area,
                    }))
                ),
                restriction_details: JSON.stringify(
                    restrictions.slice(0, 10).map((r) => ({
                        zoneName: r.zoneName,
                        restrictionType: r.restrictionType,
                        description: r.description,
                    }))
                ),
                auction_data: JSON.stringify({
                    사건번호: item["사건번호"],
                    물건종류: item["물건종류"],
                    지목: item["지목"],
                    감정평가액: item["감정평가액"],
                    최저매각가격: item["최저매각가격"],
                    "%": item["%"],
                    매각기일: item["매각기일"],
                    면적: item["면적"],
                    유찰회수: item["유찰회수"],
                    "공시지가(원/㎡)": item["공시지가(원/㎡)"],
                    공시지가총액: item["공시지가총액"],
                    "최저가/공시지가비율": item["최저가/공시지가비율"],
                    시설경과연수: item["시설경과연수"],
                    score_breakdown: scoreResult.components,
                    gosi_stage: maxGosiStage,
                }),
                batch_id: batchId,
            });
        } catch (err) {
            console.error(`[Precompute] Error scoring ${address}:`, err);
        }
    }

    // Reverse match hot zones with scored items
    if (allHotZones.length > 0) {
        try {
            const scoredItems = await getPropertyScores({ limit: 200 });
            const reverseAlerts = reverseMatchHotZones(
                allHotZones,
                scoredItems.map((s) => ({ doc_id: s.doc_id, dong: s.dong, pnu: s.pnu }))
            );
            if (reverseAlerts.length > 0) {
                const cacheAlerts = reverseAlerts.map((a) => ({
                    alert_id: `${a.zone.areaCd}_${a.zone.gosiStage}_${Date.now()}`,
                    zone_title: a.zone.gosiTitle,
                    zone_stage: a.zone.gosiStage,
                    zone_area_cd: a.zone.areaCd,
                    zone_dong_names: JSON.stringify(a.zone.dongNames),
                    matched_doc_ids: JSON.stringify(a.matchedDocIds),
                    created_at: Date.now(),
                    reviewed: 0,
                }));
                await setHotZoneAlerts(cacheAlerts);
                console.log(`[Precompute] Saved ${cacheAlerts.length} hot zone alerts`);
            }
        } catch (err) {
            console.error("[Precompute] Hot zone reverse matching error:", err);
        }
    }

    // Atomically swap: delete old scores now that new batch is complete
    if (scoredCount > 0) {
        await clearPropertyScores(batchId);
        console.log(`[Precompute] Old scores cleared. Batch ${batchId} is now live.`);
    } else {
        console.warn(`[Precompute] No items scored — keeping old scores as fallback.`);
    }

    console.log(
        `[Precompute] Batch ${batchId} complete. Scored: ${scoredCount}/${allItems.length} (resolved=${resolvedCount}, regions=${signalCache.size}, eumAreas=${eumCache.size})`
    );
}

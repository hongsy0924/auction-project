import { NextRequest } from "next/server";
import { getAllAuctionItems } from "@/lib/db";
import { resolveAddressToCouncils } from "@/lib/minutes/address-resolver";
import {
    getRegionSignals,
    setRegionSignals,
    setPropertyScore,
    clearPropertyScores,
    type RegionSignal,
} from "@/lib/minutes/cache";
import { ClikClient } from "@/lib/minutes/clik-client";
import { getUrbanPlanFacilities, type UrbanPlanFacility } from "@/lib/luris/client";
import {
    getEumNotices,
    getEumDevPermits,
    getEumRestrictions,
} from "@/lib/eum/client";
import type { CachedEumNotice, CachedEumPermit, CachedEumRestriction } from "@/lib/minutes/cache";

const SIGNAL_KEYWORDS = ["보상", "편입", "수용", "개발", "착공", "도시계획", "도로", "택지"];

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
    const authHeader = request.headers.get("authorization");
    const secret = process.env.PRECOMPUTE_SECRET;
    console.log(`[Precompute] Auth debug: header=${JSON.stringify(authHeader)}, secret_len=${secret?.length}, match=${authHeader === \`Bearer \${secret}\`}`);
    if (!secret || authHeader !== `Bearer ${secret}`) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const batchId = new Date().toISOString().slice(0, 10);

    // Respond immediately, process in background
    processAllItems(batchId).catch((err) => {
        console.error("[Precompute] Fatal error:", err);
    });

    return Response.json({
        status: "started",
        batchId,
        message: "Pre-computation started in background",
    });
}

// --- Scoring formula V2 ---

function computeScoreV2(
    signals: RegionSignal[],
    facilities: UrbanPlanFacility[],
    notices: CachedEumNotice[],
    permits: CachedEumPermit[],
    restrictions: CachedEumRestriction[],
    pnu: string,
): number {
    let score = 0;

    // 1. EUM 고시정보 (strongest signal, 40 pts each)
    score += notices.length * 40;

    // PNU cross-match bonus: notice mentions this specific area
    const pnuPrefix = pnu ? pnu.substring(0, 10) : "";
    if (pnuPrefix) {
        const pnuMatches = notices.filter((n) =>
            n.relatedAddress && n.relatedAddress.length > 0
        );
        // Rough match: any notice in the same area gets partial bonus
        score += Math.min(pnuMatches.length, 3) * 30;
    }

    // 2. EUM 개발인허가 (25 pts each, cap at 5)
    score += Math.min(permits.length, 5) * 25;

    // 3. EUM 행위제한 (5 pts each)
    score += restrictions.length * 5;

    // 4. LURIS urban plan facilities (10 pts + unexecuted 15 pts)
    score += facilities.length * 10;
    const unexecuted = facilities.filter(
        (f) => f.executionStatus && f.executionStatus !== "집행완료"
    );
    score += unexecuted.length * 15;

    // 5. CLIK signals (weakest, capped at 20)
    let clikScore = 0;
    for (const signal of signals) {
        const weight =
            ["보상", "수용"].includes(signal.keyword) ? 20 :
            ["편입"].includes(signal.keyword) ? 15 :
            ["도시계획", "착공"].includes(signal.keyword) ? 10 : 2;
        clikScore += signal.doc_count * weight;
    }
    score += Math.min(clikScore, 20);

    return score;
}

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

async function processAllItems(batchId: string) {
    console.log(`[Precompute] Starting batch ${batchId}`);

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

    // Clear previous scores
    console.log(`[Precompute] Clearing previous scores...`);
    await clearPropertyScores();
    console.log(`[Precompute] Scores cleared. Starting scoring...`);

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

            const score = computeScoreV2(signalResults, facilities, notices, permits, restrictions, pnu);
            if (score === 0) continue;

            const hasCompensation = signalResults.some((s) =>
                ["보상", "수용", "편입"].includes(s.keyword)
            );
            const hasUnexecuted = facilities.some(
                (f) => f.executionStatus && f.executionStatus !== "집행완료"
            );
            const hasPnuMatch = notices.some((n) =>
                n.relatedAddress && n.relatedAddress.length > 0
            ) ? 1 : 0;

            scoredCount++;

            await setPropertyScore({
                doc_id: docId,
                address,
                dong: location.dong || String(item["동"] || ""),
                pnu,
                sido: location.sido,
                sigungu: location.sigungu,
                score,
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
                has_pnu_match: hasPnuMatch,
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
                }),
                batch_id: batchId,
            });
        } catch (err) {
            console.error(`[Precompute] Error scoring ${address}:`, err);
        }
    }

    console.log(
        `[Precompute] Batch ${batchId} complete. Scored: ${scoredCount}/${allItems.length} (resolved=${resolvedCount}, regions=${signalCache.size}, eumAreas=${eumCache.size})`
    );
}

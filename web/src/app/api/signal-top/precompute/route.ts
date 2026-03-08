import { NextRequest } from "next/server";
import { getAllAuctionItems } from "@/lib/db";
import { resolveAddressToCouncils } from "@/lib/minutes/address-resolver";
import {
    getRegionSignals,
    setRegionSignals,
    setPropertyScore,
    clearPropertyScores,
    setPropertyAnalysis,
    getPropertyAnalysis,
    type RegionSignal,
} from "@/lib/minutes/cache";
import { ClikClient } from "@/lib/minutes/clik-client";
import { getUrbanPlanFacilities, type UrbanPlanFacility } from "@/lib/luris/client";
import { MinutesService } from "@/lib/minutes/workflow";

const SIGNAL_KEYWORDS = ["보상", "편입", "수용", "개발", "착공", "도시계획", "도로", "택지"];

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
    const authHeader = request.headers.get("authorization");
    const secret = process.env.PRECOMPUTE_SECRET;
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

// --- Scoring formula ---

function computeScore(signals: RegionSignal[], facilities: UrbanPlanFacility[]): number {
    let score = 0;

    for (const signal of signals) {
        const weight =
            ["보상", "수용"].includes(signal.keyword) ? 20 :
            ["편입"].includes(signal.keyword) ? 15 :
            ["도시계획", "착공"].includes(signal.keyword) ? 10 : 2;
        score += signal.doc_count * weight;
    }

    score += facilities.length * 10;

    const unexecuted = facilities.filter(
        (f) => f.executionStatus && f.executionStatus !== "집행완료"
    );
    score += unexecuted.length * 15;

    return score;
}

// --- Fetch region signals (cache-first, then CLIK API) ---

async function fetchRegionSignals(
    clikClient: ClikClient,
    councilCode: string,
    dongName: string,
): Promise<RegionSignal[]> {
    // Check cache first
    const cached = await getRegionSignals(councilCode, dongName).catch(() => [] as RegionSignal[]);
    if (cached.length > 0) return cached;

    // Cache miss → call CLIK API for all keywords in parallel
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

    // Cache results
    if (entries.length > 0) {
        await setRegionSignals(entries).catch(() => { /* ignore cache write error */ });
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

// --- Background processing ---

interface ScoredItem {
    docId: string;
    address: string;
    dong: string;
    pnu: string;
    sido: string;
    sigungu: string;
    score: number;
    councilCodes: string[];
    facilities: UrbanPlanFacility[];
    auctionData: Record<string, unknown>;
}

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

    // Clear previous scores
    console.log(`[Precompute] Clearing previous scores...`);
    await clearPropertyScores();
    console.log(`[Precompute] Scores cleared. Starting Phase A...`);

    // Phase A: Score all items
    // Pre-fetch signals per unique (councilCode, dong) to avoid redundant API calls
    const signalCache = new Map<string, RegionSignal[]>();
    const scored: ScoredItem[] = [];
    let resolvedCount = 0;
    let dongCount = 0;

    for (let idx = 0; idx < allItems.length; idx++) {
        const item = allItems[idx];
        const address = String(item["주소"] || "");
        const pnu = String(item["PNU"] || "");
        const docId = String(item["고유키"] || "");
        if (!address || !docId) continue;

        // Log first few items for debugging
        if (idx < 3) {
            console.log(`[Precompute] Processing item ${idx}: address="${address.substring(0, 30)}..." pnu="${pnu}"`);
        }

        // Progress log every 100 items
        if (idx > 0 && idx % 100 === 0) {
            console.log(`[Precompute] Progress: ${idx}/${allItems.length} (resolved=${resolvedCount}, dong=${dongCount}, scored=${scored.length}, regions=${signalCache.size})`);
        }

        try {
            const location = resolveAddressToCouncils(address);
            if (!location || location.councilCodes.length === 0) continue;
            resolvedCount++;
            if (location.dong) dongCount++;

            // Use only the most specific council (first = 시군구, skip 도/시 level)
            // This prevents score inflation from generic parent-level signals
            const primaryCouncil = location.councilCodes[0];
            const cacheKey = `${primaryCouncil.code}::${location.dong || ""}`;
            let signals = signalCache.get(cacheKey);
            if (!signals) {
                if (idx < 3) console.log(`[Precompute] Fetching signals for ${cacheKey}...`);
                signals = await fetchRegionSignals(clikClient, primaryCouncil.code, location.dong || "");
                signalCache.set(cacheKey, signals);
                if (idx < 3) console.log(`[Precompute] Got ${signals.length} signal entries for ${cacheKey}`);
            }
            const signalResults = signals.filter((s) => s.doc_count > 0);

            // Get LURIS facilities (cached with 30-day TTL)
            let facilities: UrbanPlanFacility[] = [];
            if (pnu) {
                try {
                    if (idx < 3) console.log(`[Precompute] Fetching LURIS for PNU ${pnu}...`);
                    facilities = await getUrbanPlanFacilities(pnu);
                    if (idx < 3) console.log(`[Precompute] Got ${facilities.length} facilities`);
                } catch { /* LURIS API failure is non-fatal */ }
            }

            const score = computeScore(signalResults, facilities);
            if (score === 0) continue;

            const hasCompensation = signalResults.some((s) =>
                ["보상", "수용", "편입"].includes(s.keyword)
            );
            const hasUnexecuted = facilities.some(
                (f) => f.executionStatus && f.executionStatus !== "집행완료"
            );

            scored.push({
                docId, address,
                dong: location.dong || String(item["동"] || ""),
                pnu,
                sido: location.sido,
                sigungu: location.sigungu,
                score,
                councilCodes: [primaryCouncil.code],
                facilities,
                auctionData: {
                    사건번호: item["사건번호"],
                    물건종류: item["물건종류"],
                    지목: item["지목"],
                    감정평가액: item["감정평가액"],
                    최저매각가격: item["최저매각가격"],
                    "%": item["%"],
                    매각기일: item["매각기일"],
                    면적: item["면적"],
                },
            });

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

    console.log(`[Precompute] Phase A complete: ${scored.length} items scored (${resolvedCount} resolved, ${signalCache.size} unique regions)`);

    // Phase B: Deep analysis (top scored only, with threshold + cap)
    scored.sort((a, b) => b.score - a.score);

    const ANALYSIS_THRESHOLD = 50;
    const MAX_ANALYSES = 20;
    const toAnalyze = scored.filter(s => s.score >= ANALYSIS_THRESHOLD).slice(0, MAX_ANALYSES);

    console.log(`[Precompute] Phase B: ${toAnalyze.length} items above threshold ${ANALYSIS_THRESHOLD} (max ${MAX_ANALYSES})`);

    const service = new MinutesService(clikApiKey);
    let analyzed = 0;

    for (let i = 0; i < toAnalyze.length; i++) {
        const { docId, address, dong, pnu, councilCodes, facilities } = toAnalyze[i];

        // Skip if already analyzed
        const existing = await getPropertyAnalysis(docId);
        if (existing) {
            console.log(`[Precompute] Skipping ${docId} (already analyzed)`);
            continue;
        }

        try {
            console.log(`[Precompute] Analyzing ${analyzed + 1}: ${address} (score=${toAnalyze[i].score})`);
            const markdown = await service.processPropertyAnalysis(
                address, dong, pnu, councilCodes, facilities
            );
            await setPropertyAnalysis(docId, markdown);
            analyzed++;
            console.log(`[Precompute] Analysis saved for ${docId}`);
        } catch (err) {
            console.error(`[Precompute] Analysis failed for ${address}:`, err);
        }

        // Rate limiting between analyses
        if (i < toAnalyze.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }
    }

    console.log(
        `[Precompute] Batch ${batchId} complete. Scored: ${scored.length}, Analyzed: ${analyzed}`
    );
}

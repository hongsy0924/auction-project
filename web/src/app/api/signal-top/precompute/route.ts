import { NextRequest } from "next/server";
import { getAllAuctionItems } from "@/lib/db";
import { resolveAddressToCouncils } from "@/lib/minutes/address-resolver";
import {
    getRegionSignals,
    setPropertyScore,
    clearPropertyScores,
    setPropertyAnalysis,
    getPropertyAnalysis,
    type RegionSignal,
} from "@/lib/minutes/cache";
import { getUrbanPlanFacilities, type UrbanPlanFacility } from "@/lib/luris/client";
import { MinutesService } from "@/lib/minutes/workflow";

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

    let allItems: Record<string, unknown>[];
    try {
        allItems = await getAllAuctionItems();
    } catch (err) {
        console.error("[Precompute] Failed to load auction items:", err);
        return;
    }
    console.log(`[Precompute] Loaded ${allItems.length} auction items`);

    // Clear previous scores
    await clearPropertyScores();

    // Phase A: Score all items
    const scored: ScoredItem[] = [];

    for (const item of allItems) {
        const address = String(item["주소"] || "");
        const pnu = String(item["PNU"] || "");
        const docId = String(item["고유키"] || "");
        if (!address || !docId) continue;

        try {
            const location = resolveAddressToCouncils(address);
            if (!location || location.councilCodes.length === 0) continue;

            // Get signals from all mapped councils
            const signalPromises = location.councilCodes.map((c) =>
                getRegionSignals(c.code, location.dong).catch(() => [] as RegionSignal[])
            );
            const signalResults = (await Promise.all(signalPromises))
                .flat()
                .filter((s) => s.doc_count > 0);

            // Get LURIS facilities (cached with 30-day TTL)
            let facilities: UrbanPlanFacility[] = [];
            if (pnu) {
                try {
                    facilities = await getUrbanPlanFacilities(pnu);
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
                councilCodes: location.councilCodes.map((c) => c.code),
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

    console.log(`[Precompute] Phase A complete: ${scored.length} items scored`);

    // Phase B: Deep analysis (sorted by score, skip already analyzed)
    scored.sort((a, b) => b.score - a.score);

    const clikApiKey = process.env.CLIK_API_KEY;
    if (!clikApiKey) {
        console.warn("[Precompute] CLIK_API_KEY not set, skipping deep analysis");
        return;
    }

    const service = new MinutesService(clikApiKey);
    let analyzed = 0;

    for (let i = 0; i < scored.length; i++) {
        const { docId, address, dong, pnu, councilCodes, facilities } = scored[i];

        // Skip if already analyzed
        const existing = await getPropertyAnalysis(docId);
        if (existing) {
            console.log(`[Precompute] Skipping ${docId} (already analyzed)`);
            continue;
        }

        try {
            console.log(`[Precompute] Analyzing ${analyzed + 1}: ${address} (score=${scored[i].score})`);
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
        if (i < scored.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }
    }

    console.log(
        `[Precompute] Batch ${batchId} complete. Scored: ${scored.length}, Analyzed: ${analyzed}`
    );
}

import { NextRequest } from "next/server";
import {
    getPropertyAnalysis,
    getPropertyScoreById,
    setPropertyAnalysis,
} from "@/lib/minutes/cache";
import { MinutesService } from "@/lib/minutes/workflow";
import type { UrbanPlanFacility } from "@/lib/luris/client";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const docId = new URL(request.url).searchParams.get("doc_id");
    if (!docId) {
        return Response.json({ error: "doc_id required" }, { status: 400 });
    }

    try {
        // 1. Check cache first
        const existing = await getPropertyAnalysis(docId);
        if (existing) {
            return Response.json({
                doc_id: docId,
                analysis_markdown: existing.analysis_markdown,
                analyzed_at: existing.analyzed_at,
            });
        }

        // 2. On-demand generation when cache miss
        const clikApiKey = process.env.CLIK_API_KEY;
        if (!clikApiKey) {
            return Response.json({ error: "CLIK_API_KEY not configured" }, { status: 500 });
        }

        const scoreData = await getPropertyScoreById(docId);
        if (!scoreData) {
            return Response.json({ error: "Property not found in scores" }, { status: 404 });
        }

        const facilities: UrbanPlanFacility[] = scoreData.facility_details
            ? JSON.parse(scoreData.facility_details)
            : [];

        // Extract council codes from signal_details
        const signalDetails = scoreData.signal_details
            ? JSON.parse(scoreData.signal_details)
            : [];
        const councilCodes = signalDetails.length > 0
            ? [...new Set(signalDetails.map((s: { council_code?: string }) => s.council_code).filter(Boolean))] as string[]
            : [];

        console.log(`[analysis] On-demand generation for ${docId}: ${scoreData.address}`);

        const service = new MinutesService(clikApiKey);
        const markdown = await service.processPropertyAnalysis(
            scoreData.address,
            scoreData.dong,
            scoreData.pnu,
            councilCodes,
            facilities,
        );

        await setPropertyAnalysis(docId, markdown);

        return Response.json({
            doc_id: docId,
            analysis_markdown: markdown,
            analyzed_at: Date.now(),
        });
    } catch (err) {
        console.error("[signal-top/analysis] Error:", err);
        return Response.json({ error: "Failed to generate analysis" }, { status: 500 });
    }
}

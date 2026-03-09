import { NextRequest } from "next/server";
import {
    getPropertyScores,
    getPropertyScoreCount,
    getPropertyAnalysisBatch,
} from "@/lib/minutes/cache";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const perPage = Math.min(100, Math.max(1, parseInt(searchParams.get("per_page") || "20", 10)));
    const offset = (page - 1) * perPage;

    try {
        const [items, total] = await Promise.all([
            getPropertyScores(perPage, offset),
            getPropertyScoreCount(),
        ]);

        const docIds = items.map((i) => i.doc_id);
        const analysisMap = await getPropertyAnalysisBatch(docIds);

        const data = items.map((item) => ({
            ...item,
            signal_keywords: item.signal_keywords ? JSON.parse(item.signal_keywords) : [],
            signal_details: item.signal_details ? JSON.parse(item.signal_details) : [],
            facility_details: item.facility_details ? JSON.parse(item.facility_details) : [],
            notice_details: item.notice_details ? JSON.parse(item.notice_details) : [],
            permit_details: item.permit_details ? JSON.parse(item.permit_details) : [],
            restriction_details: item.restriction_details ? JSON.parse(item.restriction_details) : [],
            auction_data: item.auction_data ? JSON.parse(item.auction_data) : {},
            has_analysis: analysisMap.has(item.doc_id),
        }));

        return Response.json({ data, total, page, perPage });
    } catch (err) {
        console.error("[signal-top] Error:", err);
        return Response.json({ error: "Failed to fetch signal scores" }, { status: 500 });
    }
}

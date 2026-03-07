import { NextRequest } from "next/server";
import { getPropertyAnalysis } from "@/lib/minutes/cache";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const docId = new URL(request.url).searchParams.get("doc_id");
    if (!docId) {
        return Response.json({ error: "doc_id required" }, { status: 400 });
    }

    try {
        const analysis = await getPropertyAnalysis(docId);
        if (!analysis) {
            return Response.json({ error: "Analysis not found" }, { status: 404 });
        }

        return Response.json({
            doc_id: docId,
            analysis_markdown: analysis.analysis_markdown,
            analyzed_at: analysis.analyzed_at,
        });
    } catch (err) {
        console.error("[signal-top/analysis] Error:", err);
        return Response.json({ error: "Failed to fetch analysis" }, { status: 500 });
    }
}

import { NextRequest, NextResponse } from "next/server";
import { MinutesService } from "@/lib/minutes/workflow";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { query } = body;

        if (!query || typeof query !== "string" || query.trim().length === 0) {
            return NextResponse.json(
                { error: "검색어를 입력해주세요." },
                { status: 400 }
            );
        }

        const clikApiKey = process.env.CLIK_API_KEY;
        if (!clikApiKey) {
            return NextResponse.json(
                { error: "CLIK API key is not configured." },
                { status: 500 }
            );
        }

        const service = new MinutesService(clikApiKey);
        const result = await service.processQuery(query.trim());

        return NextResponse.json({ result });
    } catch (error) {
        console.error("[API /minutes-search] Error:", error);
        const message = error instanceof Error ? error.message : "Internal server error";
        return NextResponse.json({ error: message }, { status: 500 });
    }
}

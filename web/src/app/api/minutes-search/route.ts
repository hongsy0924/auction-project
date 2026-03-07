import { NextRequest } from "next/server";
import { MinutesService } from "@/lib/minutes/workflow";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { query } = body;

        if (!query || typeof query !== "string" || query.trim().length === 0) {
            return new Response(
                JSON.stringify({ error: "검색어를 입력해주세요." }),
                { status: 400, headers: { "Content-Type": "application/json" } }
            );
        }

        const clikApiKey = process.env.CLIK_API_KEY;
        if (!clikApiKey) {
            return new Response(
                JSON.stringify({ error: "CLIK API key is not configured." }),
                { status: 500, headers: { "Content-Type": "application/json" } }
            );
        }

        const stream = new ReadableStream({
            async start(controller) {
                const encoder = new TextEncoder();

                const send = (event: object) => {
                    try {
                        controller.enqueue(
                            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
                        );
                    } catch {
                        // Controller may be closed if client disconnected
                    }
                };

                try {
                    const service = new MinutesService(clikApiKey);
                    await service.processQuery(query.trim(), (progress) => {
                        send(progress);
                    });
                } catch (error) {
                    console.error("[API /minutes-search] Error:", error);
                    const message = error instanceof Error ? error.message : "Internal server error";
                    send({
                        type: "error",
                        step: 0,
                        totalSteps: 5,
                        message,
                    });
                }

                controller.close();
            },
        });

        return new Response(stream, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
            },
        });
    } catch (error) {
        console.error("[API /minutes-search] Error:", error);
        const message = error instanceof Error ? error.message : "Internal server error";
        return new Response(
            JSON.stringify({ error: message }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }
}

import { NextRequest } from "next/server";
import { resolveAddressToCouncils } from "@/lib/minutes/address-resolver";
import { getRegionSignals } from "@/lib/minutes/cache";
import { getUrbanPlanFacilities } from "@/lib/luris/client";
import { MinutesService } from "@/lib/minutes/workflow";

/**
 * GET /api/auction-signals?address=...&pnu=...
 *
 * Returns Layer 1 (council mapping) + Layer 2 (cached signals) + Layer 3 (LURIS facilities).
 */
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const address = searchParams.get("address") || "";
        const pnu = searchParams.get("pnu") || "";

        if (!address) {
            return Response.json({ error: "address parameter required" }, { status: 400 });
        }

        // Layer 1: Address → council codes
        const location = resolveAddressToCouncils(address);
        const councils = location?.councilCodes || [];

        // Layer 2: Cached region signals (parallel per council)
        const signalPromises = councils.map(async (c) => {
            try {
                return await getRegionSignals(c.code, location?.dong);
            } catch {
                return [];
            }
        });
        const signalResults = await Promise.all(signalPromises);
        const signals = signalResults
            .flat()
            .filter((s) => s.doc_count > 0)
            .map((s) => ({
                keyword: s.keyword,
                doc_count: s.doc_count,
                signal_summary: s.signal_summary,
            }));

        // Layer 3: LURIS urban plan facilities
        let urbanPlanFacilities: Awaited<ReturnType<typeof getUrbanPlanFacilities>> = [];
        if (pnu) {
            try {
                urbanPlanFacilities = await getUrbanPlanFacilities(pnu);
            } catch {
                // Silently skip if LURIS fails
            }
        }

        return Response.json({
            location: location
                ? { sido: location.sido, sigungu: location.sigungu, dong: location.dong }
                : null,
            councils,
            signals,
            urbanPlanFacilities,
            hasSignals: signals.length > 0 || urbanPlanFacilities.length > 0,
        });
    } catch (error) {
        console.error("[API /auction-signals GET]", error);
        return Response.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}

/**
 * POST /api/auction-signals
 *
 * Layer 4: Deep AI analysis via SSE streaming.
 * Body: { address, pnu, dong, councilCodes, urbanPlanFacilities }
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { address, pnu, dong, councilCodes, urbanPlanFacilities } = body;

        if (!address || !councilCodes?.length) {
            return Response.json(
                { error: "address and councilCodes are required" },
                { status: 400 }
            );
        }

        const clikApiKey = process.env.CLIK_API_KEY;
        if (!clikApiKey) {
            return Response.json(
                { error: "CLIK API key not configured" },
                { status: 500 }
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
                        // Client may have disconnected
                    }
                };

                try {
                    const service = new MinutesService(clikApiKey);
                    await service.processPropertyAnalysis(
                        address,
                        dong || "",
                        pnu || "",
                        councilCodes,
                        urbanPlanFacilities || [],
                        (progress) => send(progress)
                    );
                } catch (error) {
                    console.error("[API /auction-signals POST]", error);
                    send({
                        type: "error",
                        step: 0,
                        totalSteps: 5,
                        message: error instanceof Error ? error.message : "분석 중 오류 발생",
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
        console.error("[API /auction-signals POST]", error);
        return Response.json(
            { error: "Internal server error" },
            { status: 500 }
        );
    }
}

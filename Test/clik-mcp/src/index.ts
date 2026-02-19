import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ClikClient } from "./clik-client.js";
import { MinutesService } from "./workflow.js";
import type { SearchType } from "./types.js";

const apiKey = process.env.CLIK_API_KEY;
if (!apiKey) {
    console.error("Error: CLIK_API_KEY environment variable is required.");
    process.exit(1);
}

const client = new ClikClient(apiKey);
const minutesService = new MinutesService(apiKey);

const server = new McpServer({
    name: "clik-minutes",
    version: "2.0.0",
});

// --- Tool: search_minutes ---
server.tool(
    "search_minutes",
    "지방의회 회의록을 키워드로 검색합니다. Search local council meeting minutes by keyword.",
    {
        keyword: z.string().describe("검색어 (search keyword)"),
        councilCode: z
            .string()
            .optional()
            .describe(
                "의회 기관코드 (council code, e.g. '041009' for 서산시의회). 생략 시 전체 의회 대상 검색."
            ),
        searchType: z
            .enum(["ALL", "MTR_SJ", "MINTS_HTML", "RASMBLY_NM", "PRMPST_CMIT_NM"])
            .optional()
            .describe(
                "검색 대상 필드: ALL(전체), MTR_SJ(제목), MINTS_HTML(내용), RASMBLY_NM(의회명), PRMPST_CMIT_NM(위원회명). 기본값: ALL"
            ),
        startCount: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe("페이징 시작 인덱스 (0-based, default: 0)"),
        listCount: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .describe("결과 개수 (max 100, default: 10)"),
    },
    async ({ keyword, councilCode, searchType, startCount, listCount }) => {
        try {
            const result = await client.searchMinutes({
                keyword,
                councilCode,
                searchType: searchType as SearchType | undefined,
                startCount,
                listCount,
            });

            if (result.items.length === 0) {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: `검색 결과가 없습니다. (keyword: "${keyword}"${councilCode ? `, council: ${councilCode}` : ""})`,
                        },
                    ],
                };
            }

            // Format results as readable text
            const header = `## 회의록 검색 결과 (총 ${result.totalCount}건 중 ${result.items.length}건)\n\n`;
            const rows = result.items
                .map((item, i) => {
                    const date = formatDate(item.MTG_DE);
                    return [
                        `### ${i + 1}. ${item.MTR_SJ || item.MTGNM}`,
                        `- **의회:** ${item.RASMBLY_NM}`,
                        `- **회의명:** ${item.MTGNM}`,
                        `- **회의일:** ${date}`,
                        `- **위원회:** ${item.PRMPST_CMIT_NM || "—"}`,
                        `- **문서 ID:** \`${item.DOCID}\``,
                    ].join("\n");
                })
                .join("\n\n");

            return {
                content: [{ type: "text" as const, text: header + rows }],
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: "text" as const,
                        text: `API 호출 중 오류 발생: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    }
);

// --- Tool: get_minute_detail ---
server.tool(
    "get_minute_detail",
    "특정 회의록의 상세 발언 내용(본문)을 가져옵니다. Get the full transcript of a specific council minute by document ID.",
    {
        docid: z
            .string()
            .describe(
                "회의록 문서 ID (search_minutes 결과에서 얻을 수 있음)"
            ),
    },
    async ({ docid }) => {
        try {
            const detail = await client.getMinuteDetail(docid);

            if (!detail) {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: `문서를 찾을 수 없습니다. (docid: "${docid}")`,
                        },
                    ],
                };
            }

            const date = formatDate(detail.MTG_DE);
            const header = [
                `# ${detail.MTR_SJ || detail.MTGNM}`,
                `- **의회:** ${detail.RASMBLY_NM}`,
                `- **회의명:** ${detail.MTGNM}`,
                `- **회의일:** ${date}`,
                `- **위원회:** ${detail.PRMPST_CMIT_NM || "—"}`,
                "",
                "---",
                "",
            ].join("\n");

            // Truncate to avoid context overflow (increased to 300k)
            const MAX_CHARS = 300_000;
            let transcript = detail.MINTS_HTML || "(본문 없음)";
            if (transcript.length > MAX_CHARS) {
                transcript =
                    transcript.slice(0, MAX_CHARS) +
                    `\n\n... (본문이 너무 길어 ${MAX_CHARS.toLocaleString()}자에서 잘렸습니다. 전체 ${transcript.length.toLocaleString()}자)`;
            }

            return {
                content: [
                    { type: "text" as const, text: header + transcript },
                ],
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: "text" as const,
                        text: `API 호출 중 오류 발생: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    }
);

// --- Tool: search_and_analyze_minutes ---
// This is the primary tool for end-to-end search + analysis.
// It encapsulates the full pipeline internally:
//   parseQuery → CLIK API search → fetch details → hybrid search → summarize
// Only the final summary is returned, preventing context window pollution.
server.tool(
    "search_and_analyze_minutes",
    "자연어 질의로 지방의회 회의록을 검색하고 분석합니다. Search and analyze council minutes using a natural language query. Returns a summary of relevant findings.",
    {
        query: z
            .string()
            .describe(
                "자연어 검색 쿼리 (예: '서산시에서 석지제 사업 예산 배정 논의')"
            ),
    },
    async ({ query }) => {
        try {
            const result = await minutesService.processQuery(query);
            return {
                content: [{ type: "text" as const, text: result }],
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: "text" as const,
                        text: `분석 중 오류 발생: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    }
);

/** Format YYYYMMDD to YYYY-MM-DD */
function formatDate(raw: string): string {
    if (!raw || raw.length !== 8) return raw || "—";
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

// --- Start Server ---
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("CLIK Minutes MCP server v2.0 running on stdio");
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});

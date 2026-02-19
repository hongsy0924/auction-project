import axios, { AxiosInstance } from "axios";
import type {
    SearchMinutesParams,
    MinuteListItem,
    MinuteDetail,
    ClikApiResponse,
} from "./types.js";

const API_BASE_URL = "https://clik.nanet.go.kr/openapi/minutes.do";

/**
 * Client for the CLIK Open API (지방의회 회의록)
 */
export class ClikClient {
    private apiKey: string;
    private http: AxiosInstance;

    constructor(apiKey: string) {
        if (!apiKey) {
            throw new Error("CLIK API key is required");
        }
        this.apiKey = apiKey;
        this.http = axios.create({ timeout: 60_000 });
    }

    /**
     * Search council minutes by keyword.
     */
    async searchMinutes(params: SearchMinutesParams): Promise<{
        totalCount: number;
        items: MinuteListItem[];
    }> {
        const queryParams: Record<string, string | number> = {
            key: this.apiKey,
            type: "json",
            displayType: "list",
            startCount: params.startCount ?? 0,
            listCount: params.listCount ?? 10,
            searchType: params.searchType ?? "ALL",
            searchKeyword: params.keyword,
        };

        if (params.councilCode) {
            queryParams.rasmblyId = params.councilCode;
        }

        const response = await this.http.get<ClikApiResponse<MinuteListItem>>(
            API_BASE_URL,
            { params: queryParams }
        );

        // API returns an array with one element
        const wrapper = response.data[0];

        if (!wrapper || wrapper.RESULT_CODE !== "SUCCESS") {
            throw new Error(
                `CLIK API error: ${wrapper?.RESULT_CODE ?? "NO_RESPONSE"} — ${wrapper?.RESULT_MESSAGE ?? ""}`
            );
        }

        // Each LIST entry wraps the actual data in a ROW property
        const items = (wrapper.LIST ?? []).map((entry) => entry.ROW);

        return {
            totalCount: wrapper.TOTAL_COUNT,
            items,
        };
    }

    /**
     * Get the full detail (including transcript) of a specific minute.
     * Note: The detail endpoint returns fields directly on the response object,
     * unlike the list endpoint which uses LIST/ROW wrappers.
     */
    async getMinuteDetail(docid: string): Promise<MinuteDetail | null> {
        const queryParams = {
            key: this.apiKey,
            type: "json",
            displayType: "detail",
            docid,
        };

        // Detail response is: [{ SERVICE, RESULT_CODE, DOCID, MINTS_HTML, ... }]
        const maxRetries = 3;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const response = await this.http.get<Array<Record<string, unknown>>>(
                    `https://clik.nanet.go.kr/openapi/minutes.do`,
                    {
                        params: {
                            key: this.apiKey,
                            type: "json",
                            displayType: "detail",
                            docid: docid,
                        },
                    }
                );

                const data = response.data;
                // Detail API returns an array with the object directly, NO 'LIST' wrapper
                // e.g. [{ DOCID: ..., MINTS_HTML: ... }]
                const wrapper = data[0];
                if (!wrapper || wrapper.RESULT_CODE !== "SUCCESS") {
                    throw new Error(
                        `CLIK API error: ${(wrapper?.RESULT_CODE as string) ?? "NO_RESPONSE"} — ${(wrapper?.RESULT_MESSAGE as string) ?? ""}`
                    );
                }
                if (!wrapper.DOCID) return null;

                const detail: MinuteDetail = {
                    DOCID: wrapper.DOCID as string,
                    RASMBLY_ID: wrapper.RASMBLY_ID as string,
                    RASMBLY_NM: wrapper.RASMBLY_NM as string,
                    MTGNM: wrapper.MTGNM as string,
                    MTG_DE: wrapper.MTG_DE as string,
                    RASMBLY_NUMPR: wrapper.RASMBLY_NUMPR as string,
                    MINTS_ODR: wrapper.MINTS_ODR as string | undefined,
                    PRMPST_CMIT_NM: wrapper.PRMPST_CMIT_NM as string | undefined,
                    RASMBLY_SESN: wrapper.RASMBLY_SESN as string | undefined,
                    MTR_SJ: wrapper.MTR_SJ as string | undefined,
                    MINTS_HTML: (wrapper.MINTS_HTML as string) ?? "",
                };

                // The HTML content is often full of template garbage (scripts, styles, headers)
                // We need to strip it down to the actual transcript text.
                if (detail.MINTS_HTML) {
                    detail.MINTS_HTML = this.stripHtml(detail.MINTS_HTML);
                }

                return detail;
            } catch (error: any) {
                console.warn(`Attempt ${attempt} failed for ${docid}: ${error.code || error.message}`);
                if (attempt === maxRetries) throw error;
                // Wait 1s * attempt before retrying
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }
        return null; // Should not be reached
    }

    /**
     * Clean MINTS_HTML to extract meaningful meeting content.
     * The raw HTML contains the entire page template (search forms, nav, fonts, etc.).
     * We extract only the actual transcript content.
     */
    private stripHtml(html: string): string {
        // First unescape JSON-escaped sequences (the API double-escapes HTML)
        let text = html
            .replace(/\\t/g, "")
            .replace(/\\n/g, "\n")
            .replace(/\\r/g, "")
            .replace(/\\\//g, "/");

        // Extract speaker names and their lines for structured output
        // Pattern: <span class="speaker ...">NAME</span> followed by <div class="line">TEXT</div>
        const speakerBlocks: string[] = [];

        // Extract speaker name blocks
        const speakerRegex = /<div[^>]*class="line_name"[^>]*>([\s\S]*?)<\/div>/gi;
        const lineRegex = /<div[^>]*class="line"[^>]*>([\s\S]*?)<\/div>/gi;
        const tagRegex = /<div[^>]*class="tag"[^>]*>([\s\S]*?)<\/div>/gi;
        const matterRegex = /<div[^>]*class="(?:matter_icon|type_title)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
        const timeRegex = /<div[^>]*class="time_icon"[^>]*>([\s\S]*?)<\/div>/gi;

        // Simple approach: strip tags but add structure markers
        text = text
            // Mark agenda items
            .replace(/<div[^>]*class="matter_icon"[^>]*>/gi, "\n\n【")
            .replace(/<div[^>]*class="type_title[^"]*"[^>]*>/gi, " ")
            // Mark time
            .replace(/<div[^>]*class="time_icon"[^>]*>/gi, "\n⏰ ")
            // Mark speakers
            .replace(/<div[^>]*class="line_name"[^>]*>/gi, "\n\n◆ ")
            // Mark speech lines
            .replace(/<div[^>]*class="line"[^>]*>/gi, "\n")
            // Mark tags (procedural notes like 의사봉)
            .replace(/<div[^>]*class="tag"[^>]*>/gi, "\n  ")
            // Mark attendance sections
            .replace(/<div[^>]*class="atd_title"[^>]*>/gi, "\n\n▶ ")
            .replace(/<div[^>]*class="atd_sub_title"[^>]*>/gi, "\n  • ");

        // Remove everything before the actual content (template/nav/forms)
        // The content typically starts after the header area
        const contentStart = text.indexOf("◆ ");
        const timeStart = text.indexOf("⏰ ");
        const agendaStart = text.indexOf("【");

        const starts = [contentStart, timeStart, agendaStart].filter(
            (i) => i > 0
        );
        if (starts.length > 0) {
            text = text.slice(Math.min(...starts));
        }

        // Now strip all remaining HTML tags
        text = text
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/p>/gi, "\n")
            .replace(/<p[^>]*>/gi, "\n")
            .replace(/<[^>]+>/g, "")
            // Decode HTML entities
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            // Clean up excessive whitespace
            .replace(/[ \t]+/g, " ")
            .replace(/\n[ \t]+/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();

        return text;
    }
}

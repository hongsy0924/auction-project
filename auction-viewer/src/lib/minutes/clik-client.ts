import axios, { AxiosInstance } from "axios";
import type {
    SearchMinutesParams,
    MinuteListItem,
    MinuteDetail,
    ClikApiResponse,
} from "./types";

const API_BASE_URL = "https://clik.nanet.go.kr/openapi/minutes.do";

export class ClikClient {
    private apiKey: string;
    private http: AxiosInstance;

    constructor(apiKey: string) {
        if (!apiKey) throw new Error("CLIK API key is required");
        this.apiKey = apiKey;
        this.http = axios.create({ timeout: 60_000 });
    }

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

        const wrapper = response.data[0];
        if (!wrapper || wrapper.RESULT_CODE !== "SUCCESS") {
            throw new Error(
                `CLIK API error: ${wrapper?.RESULT_CODE ?? "NO_RESPONSE"} — ${wrapper?.RESULT_MESSAGE ?? ""}`
            );
        }

        const items = (wrapper.LIST ?? []).map((entry) => entry.ROW);
        return { totalCount: wrapper.TOTAL_COUNT, items };
    }

    async getMinuteDetail(docid: string): Promise<MinuteDetail | null> {
        const maxRetries = 3;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const response = await this.http.get<Array<Record<string, unknown>>>(
                    API_BASE_URL,
                    {
                        params: {
                            key: this.apiKey,
                            type: "json",
                            displayType: "detail",
                            docid,
                        },
                    }
                );

                const wrapper = response.data[0];
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

                if (detail.MINTS_HTML) {
                    detail.MINTS_HTML = this.stripHtml(detail.MINTS_HTML);
                }

                return detail;
            } catch (error: unknown) {
                const msg = error instanceof Error ? error.message : String(error);
                console.warn(`Attempt ${attempt} failed for ${docid}: ${msg}`);
                if (attempt === maxRetries) throw error;
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }
        return null;
    }

    private stripHtml(html: string): string {
        let text = html
            .replace(/\\t/g, "")
            .replace(/\\n/g, "\n")
            .replace(/\\r/g, "")
            .replace(/\\\//g, "/");

        text = text
            .replace(/<div[^>]*class="matter_icon"[^>]*>/gi, "\n\n【")
            .replace(/<div[^>]*class="type_title[^"]*"[^>]*>/gi, " ")
            .replace(/<div[^>]*class="time_icon"[^>]*>/gi, "\n⏰ ")
            .replace(/<div[^>]*class="line_name"[^>]*>/gi, "\n\n◆ ")
            .replace(/<div[^>]*class="line"[^>]*>/gi, "\n")
            .replace(/<div[^>]*class="tag"[^>]*>/gi, "\n  ")
            .replace(/<div[^>]*class="atd_title"[^>]*>/gi, "\n\n▶ ")
            .replace(/<div[^>]*class="atd_sub_title"[^>]*>/gi, "\n  • ");

        const contentStart = text.indexOf("◆ ");
        const timeStart = text.indexOf("⏰ ");
        const agendaStart = text.indexOf("【");
        const starts = [contentStart, timeStart, agendaStart].filter(i => i > 0);
        if (starts.length > 0) {
            text = text.slice(Math.min(...starts));
        }

        text = text
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/p>/gi, "\n")
            .replace(/<p[^>]*>/gi, "\n")
            .replace(/<[^>]+>/g, "")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/[ \t]+/g, " ")
            .replace(/\n[ \t]+/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();

        return text;
    }
}

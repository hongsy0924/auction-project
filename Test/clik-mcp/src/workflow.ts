import axios from "axios";
import { ClikClient } from "./clik-client.js";
import { parseQuery, summarizeMinutes } from "./llm.js";
import { findCouncilId } from "./data/councils.js";
import type { MinuteListItem, MinuteDetail } from "./types.js";

/**
 * Configuration for the search service connection.
 */
interface SearchServiceConfig {
    /** URL of the Python search microservice */
    searchServiceUrl: string;
    /** Number of top chunks to retrieve */
    topK: number;
    /** Whether to use Contextual Retrieval */
    useContextualRetrieval: boolean;
}

const DEFAULT_CONFIG: SearchServiceConfig = {
    searchServiceUrl: process.env.SEARCH_SERVICE_URL || "http://localhost:8100",
    topK: 10,
    useContextualRetrieval: true,
};

/**
 * Response from the Python search service.
 */
interface SearchServiceResponse {
    results: SearchChunkResult[];
    total_chunks: number;
    processing_time_ms: number;
}

interface SearchChunkResult {
    text: string;
    speaker: string | null;
    agenda_context: string | null;
    score: number;
    bm25_rank: number | null;
    vector_rank: number | null;
    doc_id: string;
    meeting_name: string;
    meeting_date: string;
}

export class MinutesService {
    private clikClient: ClikClient;
    private config: SearchServiceConfig;

    constructor(apiKey: string, config?: Partial<SearchServiceConfig>) {
        this.clikClient = new ClikClient(apiKey);
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Process a natural language query through the full pipeline:
     *
     *   1. parseQuery()           — LLM extracts keywords/council/intent
     *   2. multiKeywordSearch()   — CLIK API finds candidate documents
     *   3. fetchDetails()         — Fetch full transcripts (top 20)
     *   4. hybridSearch()         — Python search service: chunk → index → search
     *   5. summarizeMinutes()     — LLM summarizes the best chunks
     */
    async processQuery(userQuery: string): Promise<string> {
        // ── Step 1: Parse Query ───────────────────────────────────────
        console.log(`[MinutesService] Analyzing query: "${userQuery}"`);
        const parsed = await parseQuery(userQuery);
        console.log("[MinutesService] Parsed:", parsed);

        if (!parsed.keywords || parsed.keywords.length === 0) {
            return "검색할 키워드를 찾지 못했습니다. 다시 질문해 주세요.";
        }

        // ── Step 2: Resolve Council & Search CLIK API ─────────────────
        let councilCode: string | undefined;
        let councilName = "전체 의회";

        if (parsed.council) {
            const mapped = findCouncilId(parsed.council);
            if (mapped) {
                councilCode = mapped.code;
                councilName = mapped.name;
                console.log(`[MinutesService] Mapped "${parsed.council}" → ${councilCode} (${councilName})`);
            } else {
                console.warn(`[MinutesService] Could not find council code for "${parsed.council}"`);
            }
        }

        console.log(`[MinutesService] Searching ${parsed.keywords.length} keyword(s) in ${councilName}...`);
        const allItems = await this.multiKeywordSearch(parsed.keywords, councilCode);
        console.log(`[MinutesService] ${allItems.length} unique results`);

        if (allItems.length === 0) {
            return `"${parsed.keywords.join(", ")}"에 대한 검색 결과가 없습니다.`;
        }

        // ── Step 3: Fetch Details (top 20) ────────────────────────────
        const itemsToFetch = allItems.slice(0, 20);
        console.log(`[MinutesService] Fetching details for ${itemsToFetch.length} documents...`);

        const detailsPromises = itemsToFetch.map(async (item) => {
            try {
                return await this.clikClient.getMinuteDetail(item.DOCID);
            } catch (e) {
                console.error(`[MinutesService] Failed to fetch ${item.DOCID}`, e);
                return null;
            }
        });

        const details = (await Promise.all(detailsPromises)).filter(
            (d): d is MinuteDetail => d !== null
        );

        if (details.length === 0) {
            return "회의록 상세 내용을 가져오지 못했습니다.";
        }

        // ── Step 4: Hybrid Search via Python Service ──────────────────
        console.log(`[MinutesService] Sending ${details.length} documents to search service...`);
        const searchResults = await this.hybridSearch(userQuery, details);

        if (searchResults.length === 0) {
            return `검색 결과는 ${allItems.length}건이 있으나, 본문에서 관련 내용을 찾지 못했습니다.`;
        }

        console.log(
            `[MinutesService] Search service returned ${searchResults.length} chunks ` +
            `(from ${details.length} documents)`
        );

        // ── Step 5: Summarize with LLM ────────────────────────────────
        const contexts = searchResults.map((r) => ({
            date: r.meeting_date,
            meeting: r.meeting_name,
            content: r.text,
            speaker: r.speaker,
            agendaContext: r.agenda_context,
        }));

        console.log(`[MinutesService] Summarizing ${contexts.length} chunks...`);
        const summary = await summarizeMinutes(userQuery, contexts, parsed.analysisFocus);
        return summary;
    }

    /**
     * Call the Python search microservice for hybrid search.
     */
    private async hybridSearch(
        query: string,
        details: MinuteDetail[]
    ): Promise<SearchChunkResult[]> {
        const documents = details.map((d) => ({
            doc_id: d.DOCID,
            text: d.MINTS_HTML || "",
            meeting_name: `${d.RASMBLY_NM} ${d.MTGNM}`,
            meeting_date: d.MTG_DE,
        }));

        try {
            const response = await axios.post<SearchServiceResponse>(
                `${this.config.searchServiceUrl}/search`,
                {
                    query,
                    documents,
                    top_k: this.config.topK,
                    use_contextual_retrieval: this.config.useContextualRetrieval,
                },
                { timeout: 120_000 } // 2 min timeout for embedding + search
            );

            console.log(
                `[MinutesService] Search service: ${response.data.total_chunks} chunks indexed, ` +
                `${response.data.results.length} results, ` +
                `${response.data.processing_time_ms.toFixed(0)}ms`
            );

            return response.data.results;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                console.error(
                    `[MinutesService] Search service error: ${error.message}`,
                    error.response?.data
                );
                // Fallback: return empty (caller will report "no results")
            } else {
                console.error("[MinutesService] Search service error:", error);
            }

            // Graceful degradation: fall back to legacy keyword windowing
            console.warn("[MinutesService] Falling back to legacy keyword windowing...");
            return this.legacyKeywordSearch(query, details);
        }
    }

    /**
     * Legacy fallback: simple keyword windowing (the old approach).
     * Used when the Python search service is unavailable.
     */
    private legacyKeywordSearch(
        query: string,
        details: MinuteDetail[]
    ): SearchChunkResult[] {
        const keywords = query.split(/\s+/).filter((w) => w.length >= 2);
        const results: SearchChunkResult[] = [];

        for (const detail of details) {
            const content = detail.MINTS_HTML || "";
            const windows = this.extractWindows(content, keywords, 3000);

            if (windows.length > 0) {
                results.push({
                    text: windows.join("\n\n[...]\n\n"),
                    speaker: null,
                    agenda_context: null,
                    score: 0,
                    bm25_rank: null,
                    vector_rank: null,
                    doc_id: detail.DOCID,
                    meeting_name: `${detail.RASMBLY_NM} ${detail.MTGNM}`,
                    meeting_date: detail.MTG_DE,
                });
            }
        }

        return results;
    }

    /**
     * Legacy: Extract text windows around keyword occurrences.
     */
    private extractWindows(
        content: string,
        keywords: string[],
        windowSize: number = 3000
    ): string[] {
        const halfWindow = Math.floor(windowSize / 2);
        const ranges: Array<[number, number]> = [];

        for (const kw of keywords) {
            let idx = content.indexOf(kw);
            while (idx !== -1) {
                const start = Math.max(0, idx - halfWindow);
                const end = Math.min(content.length, idx + kw.length + halfWindow);
                ranges.push([start, end]);
                idx = content.indexOf(kw, idx + kw.length);
            }
        }

        if (ranges.length === 0) return [];

        ranges.sort((a, b) => a[0] - b[0]);
        const merged: Array<[number, number]> = [ranges[0]];
        for (let i = 1; i < ranges.length; i++) {
            const last = merged[merged.length - 1];
            if (ranges[i][0] <= last[1]) {
                last[1] = Math.max(last[1], ranges[i][1]);
            } else {
                merged.push(ranges[i]);
            }
        }

        return merged.map(([start, end]) => content.substring(start, end));
    }

    /**
     * Run multiple searches (one per keyword) and merge/deduplicate by DOCID.
     */
    private async multiKeywordSearch(
        keywords: string[],
        councilCode?: string
    ): Promise<MinuteListItem[]> {
        const seenDocIds = new Set<string>();
        const merged: MinuteListItem[] = [];

        for (const keyword of keywords) {
            try {
                const result = await this.clikClient.searchMinutes({
                    keyword,
                    councilCode,
                    listCount: 30,
                });

                for (const item of result.items) {
                    if (!seenDocIds.has(item.DOCID)) {
                        seenDocIds.add(item.DOCID);
                        merged.push(item);
                    }
                }
            } catch (e) {
                console.error(`[MinutesService] Search failed for "${keyword}":`, e);
            }
        }

        merged.sort((a, b) => b.MTG_DE.localeCompare(a.MTG_DE));
        return merged;
    }
}

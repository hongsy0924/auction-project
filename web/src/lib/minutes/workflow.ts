import axios from "axios";
import { ClikClient } from "./clik-client";
import { parseQuery, summarizeMinutes } from "./llm";
import { nativeHybridSearch } from "./searcher";
import { findCouncilId } from "./councils";
import type { MinuteListItem, MinuteDetail } from "./types";



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

    constructor(apiKey: string) {
        this.clikClient = new ClikClient(apiKey);
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

        const details: MinuteDetail[] = [];
        const BATCH_SIZE = 5;
        const DELAY_MS = 500;

        for (let i = 0; i < itemsToFetch.length; i += BATCH_SIZE) {
            const batch = itemsToFetch.slice(i, i + BATCH_SIZE);
            const batchPromises = batch.map(async (item) => {
                try {
                    return await this.clikClient.getMinuteDetail(item.DOCID);
                } catch (e) {
                    console.error(`[MinutesService] Failed to fetch ${item.DOCID}`, e);
                    return null;
                }
            });

            const batchResults = await Promise.all(batchPromises);
            for (const result of batchResults) {
                if (result) details.push(result);
            }

            if (i + BATCH_SIZE < itemsToFetch.length) {
                await new Promise(resolve => setTimeout(resolve, DELAY_MS));
            }
        }

        if (details.length === 0) {
            return "회의록 상세 내용을 가져오지 못했습니다.";
        }

        // ── Step 4: Hybrid Search via Native TypeScript & Gemini ──────────────────
        console.log(`[MinutesService] Sending ${details.length} documents to native search service...`);
        let searchResults: any[] = [];
        try {
            const res = await nativeHybridSearch(userQuery, details);
            searchResults = res.results;
        } catch (e) {
            console.error("[MinutesService] Native search failed.", e);
        }

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

import { ClikClient } from "./clik-client";
import { parseQuery, summarizeMinutesStream } from "./llm";
import { nativeHybridSearch } from "./searcher";
import { findCouncilId } from "./councils";
import {
    getCachedSearch, setCachedSearch,
    getCachedDetail, setCachedDetail,
} from "./cache";
import type { MinuteListItem, MinuteDetail } from "./types";

export interface ProgressEvent {
    type: "progress" | "partial_result" | "done";
    step: number;
    totalSteps: number;
    message: string;
    data?: string;
}

export type ProgressCallback = (event: ProgressEvent) => void;

export class MinutesService {
    private clikClient: ClikClient;

    constructor(apiKey: string) {
        this.clikClient = new ClikClient(apiKey);
    }

    /**
     * Process a natural language query through the full pipeline with
     * streaming progress updates:
     *
     *   1. parseQuery()           — LLM extracts keywords/council/intent
     *   2. multiKeywordSearch()   — CLIK API finds candidate documents (parallel + cached)
     *   3. fetchDetails()         — Fetch full transcripts (cached)
     *   4. hybridSearch()         — BM25 pre-filter + Gemini embeddings (cached)
     *   5. summarizeMinutes()     — LLM summarizes the best chunks (streamed)
     */
    async processQuery(userQuery: string, onProgress?: ProgressCallback): Promise<string> {
        const TOTAL_STEPS = 5;
        const emit = (step: number, message: string, type: ProgressEvent["type"] = "progress", data?: string) => {
            onProgress?.({ type, step, totalSteps: TOTAL_STEPS, message, data });
        };

        // ── Step 1: Parse Query ───────────────────────────────────────
        emit(1, "쿼리 분석 중...");
        console.log(`[MinutesService] Analyzing query: "${userQuery}"`);
        const parsed = await parseQuery(userQuery);
        console.log("[MinutesService] Parsed:", parsed);

        if (!parsed.keywords || parsed.keywords.length === 0) {
            const msg = "검색할 키워드를 찾지 못했습니다. 다시 질문해 주세요.";
            emit(1, msg, "done", msg);
            return msg;
        }

        emit(1, `쿼리 분석 완료 (키워드: ${parsed.keywords.join(", ")})`);

        // ── Step 2: Resolve Council & Search CLIK API (parallel + cached) ──
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

        emit(2, `${councilName}에서 ${parsed.keywords.length}개 키워드 검색 중...`);
        const allItems = await this.multiKeywordSearch(parsed.keywords, councilCode);
        console.log(`[MinutesService] ${allItems.length} unique results`);

        if (allItems.length === 0) {
            const msg = `"${parsed.keywords.join(", ")}"에 대한 검색 결과가 없습니다.`;
            emit(2, msg, "done", msg);
            return msg;
        }

        emit(2, `${allItems.length}건의 회의록 발견`);

        // ── Step 3: Fetch Details (top 20, cached) ──────────────────
        const itemsToFetch = allItems.slice(0, 20);
        emit(3, `상세 본문 가져오는 중 (${itemsToFetch.length}건)...`);

        const details = await this.fetchDetailsWithCache(itemsToFetch);

        if (details.length === 0) {
            const msg = "회의록 상세 내용을 가져오지 못했습니다.";
            emit(3, msg, "done", msg);
            return msg;
        }

        emit(3, `상세 본문 ${details.length}건 확보 완료`);

        // ── Step 4: Hybrid Search (BM25 pre-filter + cached embeddings) ──
        emit(4, "관련 내용 검색 중...");
        console.log(`[MinutesService] Sending ${details.length} documents to native search service...`);
        let searchResults: {
            text: string;
            speaker: string | null;
            agendaContext: string | null;
            score: number;
            docId: string;
            meetingName: string;
            meetingDate: string;
        }[] = [];
        try {
            const res = await nativeHybridSearch(userQuery, details);
            searchResults = res.results;
        } catch (e) {
            console.error("[MinutesService] Native search failed.", e);
        }

        if (searchResults.length === 0) {
            const msg = `검색 결과는 ${allItems.length}건이 있으나, 본문에서 관련 내용을 찾지 못했습니다.`;
            emit(4, msg, "done", msg);
            return msg;
        }

        emit(4, `${searchResults.length}개 관련 구간 발견`);

        console.log(
            `[MinutesService] Search service returned ${searchResults.length} chunks ` +
            `(from ${details.length} documents)`
        );

        // ── Step 5: Summarize with LLM (streamed) ───────────────────
        const contexts = searchResults.map((r) => ({
            date: r.meetingDate,
            meeting: r.meetingName,
            content: r.text,
            speaker: r.speaker,
            agendaContext: r.agendaContext,
        }));

        emit(5, "AI 분석 결과 생성 중...");
        console.log(`[MinutesService] Summarizing ${contexts.length} chunks...`);

        let fullSummary = "";
        await summarizeMinutesStream(userQuery, contexts, parsed.analysisFocus, (token) => {
            fullSummary += token;
            emit(5, "AI 분석 결과 생성 중...", "partial_result", fullSummary);
        });

        emit(5, "분석 완료", "done", fullSummary);
        return fullSummary;
    }

    /**
     * Fetch details with persistent cache.
     * Only calls CLIK API for documents not already cached.
     */
    private async fetchDetailsWithCache(items: MinuteListItem[]): Promise<MinuteDetail[]> {
        const details: MinuteDetail[] = [];
        const uncachedItems: MinuteListItem[] = [];

        // Check cache first
        for (const item of items) {
            try {
                const cached = await getCachedDetail(item.DOCID);
                if (cached) {
                    details.push(cached as MinuteDetail);
                } else {
                    uncachedItems.push(item);
                }
            } catch {
                uncachedItems.push(item);
            }
        }

        const cacheHits = details.length;
        if (cacheHits > 0) {
            console.log(`[MinutesService] Detail cache: ${cacheHits} hits, ${uncachedItems.length} misses`);
        }

        // Fetch uncached documents in optimized batches
        const BATCH_SIZE = 10;
        const DELAY_MS = 200;

        for (let i = 0; i < uncachedItems.length; i += BATCH_SIZE) {
            const batch = uncachedItems.slice(i, i + BATCH_SIZE);
            const batchPromises = batch.map(async (item) => {
                try {
                    const detail = await this.clikClient.getMinuteDetail(item.DOCID);
                    if (detail) {
                        // Cache for future use
                        setCachedDetail(item.DOCID, detail).catch(() => {});
                    }
                    return detail;
                } catch (e) {
                    console.error(`[MinutesService] Failed to fetch ${item.DOCID}`, e);
                    return null;
                }
            });

            const batchResults = await Promise.all(batchPromises);
            for (const result of batchResults) {
                if (result) details.push(result);
            }

            if (i + BATCH_SIZE < uncachedItems.length) {
                await new Promise(resolve => setTimeout(resolve, DELAY_MS));
            }
        }

        return details;
    }

    /**
     * Search CLIK API for multiple keywords in parallel, with caching.
     */
    private async multiKeywordSearch(
        keywords: string[],
        councilCode?: string
    ): Promise<MinuteListItem[]> {
        const seenDocIds = new Set<string>();
        const merged: MinuteListItem[] = [];

        // Parallel search for all keywords
        const results = await Promise.all(
            keywords.map(async (keyword) => {
                try {
                    // Check cache first
                    const cached = await getCachedSearch(keyword, councilCode);
                    if (cached) {
                        console.log(`[MinutesService] Search cache hit for "${keyword}"`);
                        return cached as MinuteListItem[];
                    }

                    // Cache miss — call CLIK API
                    const result = await this.clikClient.searchMinutes({
                        keyword,
                        councilCode,
                        listCount: 30,
                    });

                    // Cache the results
                    setCachedSearch(keyword, councilCode, result.items).catch(() => {});

                    return result.items;
                } catch (e) {
                    console.error(`[MinutesService] Search failed for "${keyword}":`, e);
                    return [];
                }
            })
        );

        // Deduplicate and merge
        for (const items of results) {
            for (const item of items) {
                if (!seenDocIds.has(item.DOCID)) {
                    seenDocIds.add(item.DOCID);
                    merged.push(item);
                }
            }
        }

        merged.sort((a, b) => b.MTG_DE.localeCompare(a.MTG_DE));
        return merged;
    }
}

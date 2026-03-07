import { GoogleGenAI } from "@google/genai";
import { MinuteDetail } from "./types";
import { hashText, getCachedEmbeddings, setCachedEmbeddings } from "./cache";

let genAI: GoogleGenAI | null = null;

function getModel() {
    if (genAI) return genAI;
    const API_KEY = process.env.GEMINI_API_KEY;
    if (!API_KEY) throw new Error("GEMINI_API_KEY is not set in environment variables.");
    genAI = new GoogleGenAI({ apiKey: API_KEY });
    return genAI;
}

export interface Chunk {
    text: string;
    speaker: string | null;
    agendaContext: string | null;
    docId: string;
    meetingName: string;
    meetingDate: string;
    score: number;
}

export interface SearchResult {
    results: Chunk[];
    totalChunks: number;
    processingTimeMs: number;
}

// --- 1. Structure-Aware Recursive Chunker ---

const SPEAKER_RE = /◆\s*(.+)/;
const AGENDA_RE = /【([^】]*?)】?/;
const STRUCTURE_BOUNDARY = /\n\n(?=◆ |【)/g;

function splitByStructure(text: string): { text: string; startIdx: number }[] {
    const segments: { text: string; startIdx: number }[] = [];
    let lastIdx = 0;

    let match;
    while ((match = STRUCTURE_BOUNDARY.exec(text)) !== null) {
        const seg = text.substring(lastIdx, match.index);
        if (seg.trim()) {
            segments.push({ text: seg, startIdx: lastIdx });
        }
        lastIdx = match.index + 2; // skip \n\n, keep marker
    }

    const remaining = text.substring(lastIdx);
    if (remaining.trim()) {
        segments.push({ text: remaining, startIdx: lastIdx });
    }

    return segments;
}

function recursiveSplit(text: string, maxSize: number, separators: RegExp[]): string[] {
    if (text.length <= maxSize) return [text];
    if (separators.length === 0) return hardSplit(text, maxSize);

    const [currentSep, ...remainingSeps] = separators;
    const pieces = text.split(currentSep);

    if (pieces.length <= 1) return recursiveSplit(text, maxSize, remainingSeps);

    const result: string[] = [];
    let buffer = "";

    for (const piece of pieces) {
        const joiner = buffer ? "\n\n" : "";
        if (buffer.length + joiner.length + piece.length <= maxSize) {
            buffer += joiner + piece;
        } else {
            if (buffer) result.push(buffer);
            if (piece.length > maxSize) {
                result.push(...recursiveSplit(piece, maxSize, remainingSeps));
                buffer = "";
            } else {
                buffer = piece;
            }
        }
    }

    if (buffer) result.push(buffer);
    return result;
}

function hardSplit(text: string, maxSize: number): string[] {
    const pieces: string[] = [];
    let remaining = text;

    while (remaining.length > maxSize) {
        let splitAt = remaining.lastIndexOf(" ", maxSize);
        if (splitAt <= 0) splitAt = remaining.lastIndexOf("\n", maxSize);
        if (splitAt <= 0) splitAt = maxSize;

        pieces.push(remaining.substring(0, splitAt));
        remaining = remaining.substring(splitAt).trimStart();
    }

    if (remaining) pieces.push(remaining);
    return pieces;
}

function extractSpeaker(text: string): string | null {
    const m = text.match(SPEAKER_RE);
    if (!m) return null;
    return m[1].split("\n")[0].trim().replace(/:$/, "");
}

function extractAgenda(text: string): string | null {
    const m = text.match(AGENDA_RE);
    if (!m) return null;
    return m[1].trim() || null;
}

function chunkTranscript(text: string, docId: string, meetingName: string, meetingDate: string): Chunk[] {
    const MAX_CHUNK_SIZE = 1200;
    const MIN_CHUNK_SIZE = 100;

    if (!text || !text.trim()) return [];

    const rawSegments = splitByStructure(text);
    const chunks: Chunk[] = [];

    let currentSpeaker: string | null = null;
    let currentAgenda: string | null = null;

    for (const seg of rawSegments) {
        const detectedSpeaker = extractSpeaker(seg.text);
        if (detectedSpeaker) currentSpeaker = detectedSpeaker;

        const detectedAgenda = extractAgenda(seg.text);
        if (detectedAgenda) currentAgenda = detectedAgenda;

        const subTexts = recursiveSplit(seg.text, MAX_CHUNK_SIZE, [/\n\n/, /(?<=[.?!。])\s+/, /(?<=[,，])\s+/]);

        for (const sub of subTexts) {
            const trimmed = sub.trim();
            if (trimmed.length < MIN_CHUNK_SIZE) continue;

            let finalText = trimmed;
            if (currentSpeaker && !trimmed.startsWith("◆")) {
                finalText = `[화자: ${currentSpeaker}]\n${trimmed}`;
            }

            chunks.push({
                text: finalText,
                speaker: currentSpeaker,
                agendaContext: currentAgenda,
                docId,
                meetingName,
                meetingDate,
                score: 0
            });
        }
    }

    return chunks;
}

// --- 2. BM25 Pre-filter ---

function tokenize(text: string): string[] {
    // Simple Korean-aware tokenization: split on whitespace and punctuation
    return text
        .toLowerCase()
        .replace(/[^\w가-힣\s]/g, " ")
        .split(/\s+/)
        .filter(t => t.length >= 2);
}

function bm25PreFilter(query: string, chunks: Chunk[], topK: number): Chunk[] {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return chunks.slice(0, topK);

    // Build document frequency map
    const df = new Map<string, number>();
    const chunkTokens: string[][] = [];

    for (const chunk of chunks) {
        const tokens = tokenize(chunk.text);
        chunkTokens.push(tokens);
        const uniqueTokens = new Set(tokens);
        for (const token of uniqueTokens) {
            df.set(token, (df.get(token) || 0) + 1);
        }
    }

    const N = chunks.length;
    const avgDl = chunkTokens.reduce((sum, t) => sum + t.length, 0) / N;
    const k1 = 1.5;
    const b = 0.75;

    // Score each chunk
    const scored = chunks.map((chunk, idx) => {
        const tokens = chunkTokens[idx];
        const dl = tokens.length;

        // Count term frequencies
        const tf = new Map<string, number>();
        for (const token of tokens) {
            tf.set(token, (tf.get(token) || 0) + 1);
        }

        let score = 0;
        for (const qt of queryTokens) {
            const termDf = df.get(qt) || 0;
            if (termDf === 0) continue;

            const idf = Math.log((N - termDf + 0.5) / (termDf + 0.5) + 1);
            const termTf = tf.get(qt) || 0;
            const tfNorm = (termTf * (k1 + 1)) / (termTf + k1 * (1 - b + b * dl / avgDl));
            score += idf * tfNorm;
        }

        return { chunk, score };
    });

    // Sort by BM25 score and take top K
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map(s => s.chunk);
}

// --- 3. Embedding & Cosine Similarity Search (with cache) ---

function cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function nativeHybridSearch(query: string, details: MinuteDetail[]): Promise<SearchResult> {
    const start = Date.now();
    const ai = getModel();

    // 1. Chunking
    const allChunks: Chunk[] = [];
    for (const doc of details) {
        const text = (doc.MINTS_HTML || "").substring(0, 50000);
        const meetingName = `${doc.RASMBLY_NM} ${doc.MTGNM}`;
        const meetingDate = doc.MTG_DE;
        allChunks.push(...chunkTranscript(text, doc.DOCID, meetingName, meetingDate));
    }

    if (allChunks.length === 0) {
        return { results: [], totalChunks: 0, processingTimeMs: Date.now() - start };
    }

    console.log(`[Searcher] Chunked ${details.length} documents into ${allChunks.length} chunks.`);

    // 2. BM25 Pre-filter: narrow down to top 50 candidates
    const BM25_TOP_K = 50;
    const candidates = bm25PreFilter(query, allChunks, BM25_TOP_K);
    console.log(`[Searcher] BM25 pre-filter: ${allChunks.length} → ${candidates.length} candidates`);

    // 3. Embedding with cache
    try {
        // Compute hashes for all candidates
        const chunkHashes = candidates.map(c => hashText(c.text));

        // Check embedding cache
        const cachedEmbeddings = await getCachedEmbeddings(chunkHashes);
        const cacheHits = cachedEmbeddings.size;

        // Determine which chunks need new embeddings
        const uncachedIndices: number[] = [];
        for (let i = 0; i < candidates.length; i++) {
            if (!cachedEmbeddings.has(chunkHashes[i])) {
                uncachedIndices.push(i);
            }
        }

        console.log(`[Searcher] Embedding cache: ${cacheHits} hits, ${uncachedIndices.length} misses`);

        // Generate embeddings only for uncached chunks + query
        const textsToEmbed: string[] = [`query: ${query}`];
        for (const idx of uncachedIndices) {
            textsToEmbed.push(`passage: ${candidates[idx].text}`);
        }

        const newEmbeddings: number[][] = [];
        if (textsToEmbed.length > 0) {
            const BATCH_SIZE = 100;
            const DELAY_MS = 1500;

            for (let i = 0; i < textsToEmbed.length; i += BATCH_SIZE) {
                const batch = textsToEmbed.slice(i, i + BATCH_SIZE);
                const response = await ai.models.embedContent({
                    model: 'gemini-embedding-001',
                    contents: batch,
                });
                if (!response.embeddings || response.embeddings.length !== batch.length) {
                    throw new Error("Missing embeddings from response batch");
                }
                for (const emb of response.embeddings) {
                    if (emb.values) {
                        newEmbeddings.push(emb.values);
                    }
                }

                if (i + BATCH_SIZE < textsToEmbed.length) {
                    await new Promise(resolve => setTimeout(resolve, DELAY_MS));
                }
            }
        }

        // Extract query embedding (always index 0)
        const queryEmbedding = newEmbeddings[0];
        if (!queryEmbedding) throw new Error("Missing query embedding");

        // Map new embeddings back to chunks and cache them
        const newEmbeddingEntries: { hash: string; embedding: number[] }[] = [];
        for (let i = 0; i < uncachedIndices.length; i++) {
            const chunkIdx = uncachedIndices[i];
            const embedding = newEmbeddings[i + 1]; // +1 to skip query embedding
            if (embedding) {
                cachedEmbeddings.set(chunkHashes[chunkIdx], embedding);
                newEmbeddingEntries.push({ hash: chunkHashes[chunkIdx], embedding });
            }
        }

        // Persist new embeddings to cache (fire-and-forget)
        if (newEmbeddingEntries.length > 0) {
            setCachedEmbeddings(newEmbeddingEntries).catch(() => {});
        }

        // 4. Score all candidates by cosine similarity
        for (let i = 0; i < candidates.length; i++) {
            const chunkEmbedding = cachedEmbeddings.get(chunkHashes[i]);
            if (chunkEmbedding) {
                candidates[i].score = cosineSimilarity(queryEmbedding, chunkEmbedding);
            }
        }

        // 5. Sort and return top 10
        candidates.sort((a, b) => b.score - a.score);
        const topResults = candidates.slice(0, 10);

        const elapsed = Date.now() - start;
        console.log(`[Searcher] Search completed in ${elapsed}ms. Returning ${topResults.length} chunks.`);

        return {
            results: topResults,
            totalChunks: allChunks.length,
            processingTimeMs: elapsed
        };

    } catch (e) {
        console.error("[Searcher] Gemini Embeddings failed:", e);
        throw e;
    }
}

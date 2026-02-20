import { GoogleGenAI } from "@google/genai";
import { MinuteDetail } from "./types";

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
    // We want to split but keep the separator. In JS split with regex group keeps it in array.
    // Instead we will split and then re-join if needed. Let's just use simple split.
    const pieces = text.split(currentSep);

    // If the separator includes lookbehinds, split might not eat the char. 
    // Since JS lookbehinds exist and we use simple strings for boundaries, let's just do a greedy split.
    // A simpler approximation of the Python recursive split:
    if (pieces.length <= 1) return recursiveSplit(text, maxSize, remainingSeps);

    const result: string[] = [];
    let buffer = "";

    for (const piece of pieces) {
        const joiner = buffer ? "\n\n" : ""; // simplify separator
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

// --- 2. Embedding & Math Vector Search ---

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

    // 2. Embeddings via Gemini
    try {
        const textsToEmbed = allChunks.map(c => `passage: ${c.text}`);
        textsToEmbed.unshift(`query: ${query}`); // index 0 is the query

        const allEmbeddings: number[][] = [];
        const BATCH_SIZE = 100;

        for (let i = 0; i < textsToEmbed.length; i += BATCH_SIZE) {
            const batch = textsToEmbed.slice(i, i + BATCH_SIZE);
            const response = await ai.models.embedContent({
                model: 'gemini-embedding-001',
                contents: batch,
            });
            if (!response.embeddings || response.embeddings.length !== batch.length) {
                throw new Error("Missing embeddings from response batch");
            }
            batch.forEach((emb, index) => {
                const values = response.embeddings![index].values;
                if (values) {
                    allEmbeddings.push(values);
                }
            });
        }

        const queryEmbedding = allEmbeddings[0];
        if (!queryEmbedding) throw new Error("Missing query embedding");

        for (let i = 0; i < allChunks.length; i++) {
            const chunkEmbedding = allEmbeddings[i + 1];
            if (chunkEmbedding) {
                allChunks[i].score = cosineSimilarity(queryEmbedding, chunkEmbedding);
            }
        }

        // 3. Sort by Cosine Similarity and take Top 10
        allChunks.sort((a, b) => b.score - a.score);
        const topResults = allChunks.slice(0, 10);

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

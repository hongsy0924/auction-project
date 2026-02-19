/**
 * Structure-Aware Recursive Chunker for Korean Council Minutes
 *
 * Replaces the naive 3,000-char fixed windowing with intelligent chunking
 * that preserves:
 *   - Speaker attribution (◆ markers from stripHtml())
 *   - Agenda context (【...】 markers)
 *   - Sentence/paragraph boundaries
 *
 * Designed for the already-stripped text output of ClikClient.stripHtml().
 */

export interface Chunk {
    /** The chunk text content */
    text: string;
    /** Speaker name for this chunk (carried forward if split mid-speech) */
    speaker: string | null;
    /** Current agenda item context */
    agendaContext: string | null;
    /** Original start index in the source text */
    startIdx: number;
    /** Original end index in the source text */
    endIdx: number;
    /** Chunk index in sequence */
    index: number;
}

export interface ChunkerOptions {
    /**
     * Target maximum characters per chunk.
     * Korean ≈ 1.5-3 tokens/char, so 1200 chars ≈ ~600-800 tokens.
     * @default 1200
     */
    maxChunkSize?: number;
    /**
     * Minimum chunk size to avoid tiny fragments.
     * @default 100
     */
    minChunkSize?: number;
}

// ── Separator hierarchy for Korean council minutes ─────────────────────
// Priority 1: Speaker change (◆ marker from stripHtml)
const SPEAKER_SEPARATOR = /\n\n◆ /;
// Priority 2: Agenda item (【 marker from stripHtml)
const AGENDA_SEPARATOR = /\n\n【/;
// Priority 3: Paragraph break
const PARAGRAPH_SEPARATOR = /\n\n/;
// Priority 4: Sentence-ending punctuation (Korean period, question/exclamation marks)
const SENTENCE_SEPARATOR = /(?<=[.?!。])\s+/;
// Priority 5: Comma or natural pause
const CLAUSE_SEPARATOR = /(?<=[,，])\s+/;

// Speaker name extraction: ◆ at line start, followed by name
const SPEAKER_REGEX = /◆\s*(.+)/;
// Agenda extraction: 【...】 or 【... (text until end of line)
const AGENDA_REGEX = /【([^】]*?)】?/;

/**
 * Chunk a council minutes transcript using structure-aware recursive splitting.
 *
 * The text is expected to be pre-processed by ClikClient.stripHtml(), which
 * produces markers like:
 *   ◆ 김의원  (speaker)
 *   【안건명】 (agenda item)
 *   ⏰ 시간    (timestamp)
 */
export function chunkTranscript(
    text: string,
    options: ChunkerOptions = {}
): Chunk[] {
    const { maxChunkSize = 1200, minChunkSize = 100 } = options;

    if (!text || text.trim().length === 0) {
        return [];
    }

    // Step 1: Split into top-level segments by speaker/agenda boundaries
    const rawSegments = splitByStructure(text);

    // Step 2: Recursively split oversized segments
    const chunks: Chunk[] = [];
    let currentSpeaker: string | null = null;
    let currentAgenda: string | null = null;
    let chunkIndex = 0;

    for (const segment of rawSegments) {
        // Update speaker/agenda context from this segment
        const detectedSpeaker = extractSpeaker(segment.text);
        if (detectedSpeaker) {
            currentSpeaker = detectedSpeaker;
        }

        const detectedAgenda = extractAgenda(segment.text);
        if (detectedAgenda) {
            currentAgenda = detectedAgenda;
        }

        // Recursively split if too large
        const subTexts = recursiveSplit(
            segment.text,
            maxChunkSize,
            [PARAGRAPH_SEPARATOR, SENTENCE_SEPARATOR, CLAUSE_SEPARATOR]
        );

        for (const subText of subTexts) {
            const trimmed = subText.trim();
            if (trimmed.length < minChunkSize) continue;

            // Prepend speaker prefix if chunk doesn't start with one
            let finalText = trimmed;
            if (currentSpeaker && !trimmed.startsWith("◆")) {
                finalText = `[화자: ${currentSpeaker}]\n${trimmed}`;
            }

            chunks.push({
                text: finalText,
                speaker: currentSpeaker,
                agendaContext: currentAgenda,
                startIdx: segment.startIdx,
                endIdx: segment.startIdx + subText.length,
                index: chunkIndex++,
            });
        }
    }

    return chunks;
}

// ── Internal helpers ───────────────────────────────────────────────────

interface RawSegment {
    text: string;
    startIdx: number;
}

/**
 * Split text by speaker and agenda markers (top-level structural boundaries).
 * Preserves the marker in each segment.
 */
function splitByStructure(text: string): RawSegment[] {
    // Combined pattern: split on speaker OR agenda boundaries
    const boundaryPattern = /\n\n(?=◆ |【)/g;
    const segments: RawSegment[] = [];

    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = boundaryPattern.exec(text)) !== null) {
        const segText = text.slice(lastIndex, match.index);
        if (segText.trim().length > 0) {
            segments.push({ text: segText, startIdx: lastIndex });
        }
        lastIndex = match.index + 2; // skip the \n\n, keep the marker
    }

    // Last segment
    const remaining = text.slice(lastIndex);
    if (remaining.trim().length > 0) {
        segments.push({ text: remaining, startIdx: lastIndex });
    }

    return segments;
}

/**
 * Recursively split text using a hierarchy of separators.
 * Tries the first separator; if any resulting piece is still too large,
 * recursively tries the next separator on that piece.
 */
function recursiveSplit(
    text: string,
    maxSize: number,
    separators: RegExp[]
): string[] {
    if (text.length <= maxSize) {
        return [text];
    }

    if (separators.length === 0) {
        // No more separators — hard-split by maxSize at nearest space
        return hardSplit(text, maxSize);
    }

    const [currentSep, ...remainingSeps] = separators;
    const pieces = text.split(currentSep);

    if (pieces.length <= 1) {
        // Separator didn't split — try next level
        return recursiveSplit(text, maxSize, remainingSeps);
    }

    const result: string[] = [];
    let buffer = "";

    for (const piece of pieces) {
        if (buffer.length + piece.length <= maxSize) {
            buffer += (buffer ? "\n\n" : "") + piece;
        } else {
            if (buffer) result.push(buffer);
            if (piece.length > maxSize) {
                // This piece alone is too large — recurse deeper
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

/**
 * Last-resort hard split: break at the nearest whitespace before maxSize.
 */
function hardSplit(text: string, maxSize: number): string[] {
    const pieces: string[] = [];
    let remaining = text;

    while (remaining.length > maxSize) {
        // Find last space within maxSize boundary
        let splitAt = remaining.lastIndexOf(" ", maxSize);
        if (splitAt <= 0) {
            splitAt = remaining.lastIndexOf("\n", maxSize);
        }
        if (splitAt <= 0) {
            // No good break point — force split
            splitAt = maxSize;
        }

        pieces.push(remaining.slice(0, splitAt));
        remaining = remaining.slice(splitAt).trimStart();
    }

    if (remaining.length > 0) {
        pieces.push(remaining);
    }

    return pieces;
}

/** Extract speaker name from a text block (looks for ◆ marker) */
function extractSpeaker(text: string): string | null {
    const match = text.match(SPEAKER_REGEX);
    if (!match) return null;

    // Clean up: speaker name is typically one line
    const name = match[1].split("\n")[0].trim();
    // Remove trailing punctuation or whitespace artifacts
    return name.replace(/[:\s]+$/, "") || null;
}

/** Extract agenda context from a text block (looks for 【 marker) */
function extractAgenda(text: string): string | null {
    const match = text.match(AGENDA_REGEX);
    if (!match) return null;
    return match[1].trim() || null;
}

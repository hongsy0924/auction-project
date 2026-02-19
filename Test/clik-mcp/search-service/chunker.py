"""
Structure-Aware Recursive Chunker for Korean Council Minutes (Python port).

Splits pre-processed council minutes text (from ClikClient.stripHtml()) into
semantically coherent chunks that preserve:
  - Speaker attribution (◆ markers)
  - Agenda context (【...】 markers)
  - Sentence/paragraph boundaries
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class Chunk:
    """A single chunk of council minutes text with metadata."""
    text: str
    speaker: Optional[str] = None
    agenda_context: Optional[str] = None
    start_idx: int = 0
    end_idx: int = 0
    index: int = 0


# ── Separator patterns ─────────────────────────────────────────────────
SPEAKER_RE = re.compile(r"◆\s*(.+)")
AGENDA_RE = re.compile(r"【([^】]*?)】?")

# Split hierarchy (applied in order of priority)
PARAGRAPH_SEP = re.compile(r"\n\n")
SENTENCE_SEP = re.compile(r"(?<=[.?!。])\s+")
CLAUSE_SEP = re.compile(r"(?<=[,，])\s+")

# Top-level structural boundary (speaker or agenda change)
STRUCTURE_BOUNDARY = re.compile(r"\n\n(?=◆ |【)")


def chunk_transcript(
    text: str,
    max_chunk_size: int = 1200,
    min_chunk_size: int = 100,
) -> list[Chunk]:
    """
    Chunk a council minutes transcript using structure-aware recursive splitting.

    Args:
        text: Pre-processed transcript text (output of stripHtml).
        max_chunk_size: Maximum characters per chunk (~800 tokens for Korean).
        min_chunk_size: Minimum characters; smaller fragments are discarded.

    Returns:
        List of Chunk objects with speaker/agenda metadata.
    """
    if not text or not text.strip():
        return []

    # Step 1: Split by top-level structural boundaries (speaker/agenda)
    raw_segments = _split_by_structure(text)

    # Step 2: Recursively split oversized segments
    chunks: list[Chunk] = []
    current_speaker: Optional[str] = None
    current_agenda: Optional[str] = None
    chunk_index = 0

    for seg_text, seg_start in raw_segments:
        # Update speaker/agenda context
        detected_speaker = _extract_speaker(seg_text)
        if detected_speaker:
            current_speaker = detected_speaker

        detected_agenda = _extract_agenda(seg_text)
        if detected_agenda:
            current_agenda = detected_agenda

        # Recursively split if too large
        sub_texts = _recursive_split(
            seg_text,
            max_chunk_size,
            [PARAGRAPH_SEP, SENTENCE_SEP, CLAUSE_SEP],
        )

        for sub in sub_texts:
            trimmed = sub.strip()
            if len(trimmed) < min_chunk_size:
                continue

            # Prepend speaker prefix if chunk doesn't start with one
            final_text = trimmed
            if current_speaker and not trimmed.startswith("◆"):
                final_text = f"[화자: {current_speaker}]\n{trimmed}"

            chunks.append(Chunk(
                text=final_text,
                speaker=current_speaker,
                agenda_context=current_agenda,
                start_idx=seg_start,
                end_idx=seg_start + len(sub),
                index=chunk_index,
            ))
            chunk_index += 1

    return chunks


# ── Internal helpers ───────────────────────────────────────────────────

def _split_by_structure(text: str) -> list[tuple[str, int]]:
    """Split text by speaker/agenda markers. Returns (text, start_idx) tuples."""
    segments: list[tuple[str, int]] = []
    last_idx = 0

    for match in STRUCTURE_BOUNDARY.finditer(text):
        seg = text[last_idx:match.start()]
        if seg.strip():
            segments.append((seg, last_idx))
        last_idx = match.start() + 2  # skip \n\n, keep marker

    remaining = text[last_idx:]
    if remaining.strip():
        segments.append((remaining, last_idx))

    return segments


def _recursive_split(
    text: str,
    max_size: int,
    separators: list[re.Pattern],
) -> list[str]:
    """Recursively split text using a hierarchy of separators."""
    if len(text) <= max_size:
        return [text]

    if not separators:
        return _hard_split(text, max_size)

    current_sep, *remaining_seps = separators
    pieces = current_sep.split(text)

    if len(pieces) <= 1:
        return _recursive_split(text, max_size, remaining_seps)

    result: list[str] = []
    buffer = ""

    for piece in pieces:
        if len(buffer) + len(piece) <= max_size:
            buffer += ("\n\n" if buffer else "") + piece
        else:
            if buffer:
                result.append(buffer)
            if len(piece) > max_size:
                result.extend(_recursive_split(piece, max_size, remaining_seps))
                buffer = ""
            else:
                buffer = piece

    if buffer:
        result.append(buffer)

    return result


def _hard_split(text: str, max_size: int) -> list[str]:
    """Last-resort: break at nearest whitespace before max_size."""
    pieces: list[str] = []
    remaining = text

    while len(remaining) > max_size:
        split_at = remaining.rfind(" ", 0, max_size)
        if split_at <= 0:
            split_at = remaining.rfind("\n", 0, max_size)
        if split_at <= 0:
            split_at = max_size

        pieces.append(remaining[:split_at])
        remaining = remaining[split_at:].lstrip()

    if remaining:
        pieces.append(remaining)

    return pieces


def _extract_speaker(text: str) -> Optional[str]:
    """Extract speaker name from ◆ marker."""
    m = SPEAKER_RE.search(text)
    if not m:
        return None
    name = m.group(1).split("\n")[0].strip().rstrip(": ")
    return name or None


def _extract_agenda(text: str) -> Optional[str]:
    """Extract agenda context from 【...】 marker."""
    m = AGENDA_RE.search(text)
    if not m:
        return None
    return m.group(1).strip() or None

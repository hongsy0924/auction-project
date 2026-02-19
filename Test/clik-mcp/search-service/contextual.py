"""
Contextual Retrieval for Council Minutes.

Implements Anthropic's Contextual Retrieval technique:
  1. Takes the full document + individual chunks
  2. Uses a fast LLM to generate a short context description per chunk
  3. Prepends the context to each chunk before indexing

This dramatically improves search accuracy by preserving global agenda context
that would otherwise be lost in individual chunks.

Uses Google Gemini Flash for fast, cheap context generation with prompt caching.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

from google import genai
from google.genai import types

from chunker import Chunk

logger = logging.getLogger(__name__)


# ── Configuration ──────────────────────────────────────────────────────

# Gemini model for context generation (fast + cheap)
CONTEXT_MODEL = "gemini-2.0-flash"

# Maximum document length to send for context generation (chars)
MAX_DOC_LENGTH = 300_000

CONTEXT_PROMPT_TEMPLATE = """다음은 지방의회 회의록 전문입니다:

<전문>
{document}
</전문>

아래는 이 회의록에서 분할된 하나의 텍스트 청크입니다:

<청크>
{chunk}
</청크>

이 청크가 전체 회의록에서 어떤 맥락에 위치하는지 간결하게 설명해주세요.
구체적으로:
1. 어떤 안건/의제에 대한 발언인지
2. 회의의 어느 시점(초반/중반/후반)인지
3. 해당 논의의 핵심 쟁점이 무엇인지

50-80자 이내로 한국어로 답변하세요. 설명만 작성하세요."""


def _get_client() -> genai.Client:
    """Get or create a Gemini client."""
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY is not set")
    return genai.Client(api_key=api_key)


def enrich_chunks_with_context(
    chunks: list[Chunk],
    full_document: str,
    batch_size: int = 5,
) -> list[Chunk]:
    """
    Enrich chunks with contextual descriptions using Gemini Flash.

    For each chunk, generates a short context description based on the
    full document, then prepends it to the chunk text.

    Args:
        chunks: List of chunks to enrich.
        full_document: The full transcript text (for context).
        batch_size: How many chunks to process in each batch.

    Returns:
        The same chunks list with enriched text (mutated in place).
    """
    if not chunks:
        return chunks

    client = _get_client()

    # Truncate document if too long
    doc_text = full_document[:MAX_DOC_LENGTH]

    logger.info(f"Enriching {len(chunks)} chunks with contextual retrieval...")

    enriched_count = 0
    for i in range(0, len(chunks), batch_size):
        batch = chunks[i:i + batch_size]

        for chunk in batch:
            try:
                context = _generate_context(client, doc_text, chunk.text)
                if context:
                    chunk.text = f"[맥락: {context}]\n{chunk.text}"
                    enriched_count += 1
            except Exception as e:
                logger.warning(f"Failed to generate context for chunk {chunk.index}: {e}")
                # Continue without context — graceful degradation

    logger.info(f"Enriched {enriched_count}/{len(chunks)} chunks")
    return chunks


def _generate_context(
    client: genai.Client,
    document: str,
    chunk_text: str,
) -> Optional[str]:
    """Generate a context description for a single chunk."""
    prompt = CONTEXT_PROMPT_TEMPLATE.format(
        document=document,
        chunk=chunk_text,
    )

    response = client.models.generate_content(
        model=CONTEXT_MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            temperature=0.1,  # Low temp for factual description
            max_output_tokens=150,
        ),
    )

    text = response.text
    if text:
        return text.strip()
    return None

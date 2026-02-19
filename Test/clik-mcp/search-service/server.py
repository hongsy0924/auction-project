"""
FastAPI server for the Council Minutes Search Microservice.

Exposes a single endpoint that accepts pre-processed transcript text,
chunks it, optionally enriches with contextual retrieval, builds
ephemeral in-memory indices, and returns the best matching chunks.

Designed to be called by the TypeScript MCP server.
"""

from __future__ import annotations

import logging
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from chunker import Chunk, chunk_transcript
from contextual import enrich_chunks_with_context
from searcher import HybridSearcher

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ── Singleton searcher (model stays loaded across requests) ────────────
searcher = HybridSearcher()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Pre-load the embedding model on startup."""
    logger.info("Pre-loading embedding model...")
    _ = searcher.model  # Trigger lazy load
    logger.info("Embedding model ready.")
    yield
    logger.info("Shutting down search service.")


app = FastAPI(
    title="Council Minutes Search Service",
    version="1.0.0",
    lifespan=lifespan,
)


# ── Request / Response Models ──────────────────────────────────────────

class SearchRequest(BaseModel):
    """Request body for the search endpoint."""
    query: str = Field(..., description="User's search query")
    documents: list[DocumentInput] = Field(
        ..., description="List of pre-processed transcript documents to search"
    )
    top_k: int = Field(default=10, ge=1, le=50, description="Number of top results")
    use_contextual_retrieval: bool = Field(
        default=True, description="Whether to enrich chunks with contextual retrieval"
    )
    max_chunk_size: int = Field(default=1200, ge=200, le=5000)
    min_chunk_size: int = Field(default=100, ge=10, le=500)


class DocumentInput(BaseModel):
    """A single document (pre-processed transcript text) to index."""
    doc_id: str = Field(..., description="Document ID (DOCID from CLIK API)")
    text: str = Field(..., description="Pre-processed transcript text")
    meeting_name: str = Field(default="", description="Meeting name for metadata")
    meeting_date: str = Field(default="", description="Meeting date (YYYYMMDD)")


class ChunkResult(BaseModel):
    """A single search result chunk."""
    text: str
    speaker: str | None = None
    agenda_context: str | None = None
    score: float
    bm25_rank: int | None = None
    vector_rank: int | None = None
    doc_id: str = ""
    meeting_name: str = ""
    meeting_date: str = ""


class SearchResponse(BaseModel):
    """Response from the search endpoint."""
    results: list[ChunkResult]
    total_chunks: int
    processing_time_ms: float


# ── Endpoints ──────────────────────────────────────────────────────────

@app.post("/search", response_model=SearchResponse)
async def search(request: SearchRequest):
    """
    Chunk documents, build indices, and search.

    Full pipeline:
      1. Chunk all documents (structure-aware recursive chunking)
      2. (Optional) Enrich with contextual retrieval
      3. Build ephemeral BM25 + FAISS indices
      4. Hybrid search with RRF fusion
      5. Return top-K results
      6. Clear indices (garbage collection)
    """
    start = time.time()

    try:
        # 1. Chunk all documents
        all_chunks: list[Chunk] = []
        doc_metadata: dict[int, DocumentInput] = {}  # chunk_index -> doc

        for doc in request.documents:
            if not doc.text.strip():
                continue

            chunks = chunk_transcript(
                doc.text,
                max_chunk_size=request.max_chunk_size,
                min_chunk_size=request.min_chunk_size,
            )

            for chunk in chunks:
                chunk.index = len(all_chunks)
                doc_metadata[chunk.index] = doc
                all_chunks.append(chunk)

        if not all_chunks:
            return SearchResponse(
                results=[], total_chunks=0,
                processing_time_ms=(time.time() - start) * 1000,
            )

        logger.info(f"Chunked {len(request.documents)} documents -> {len(all_chunks)} chunks")

        # 2. (Optional) Contextual Retrieval
        if request.use_contextual_retrieval and os.environ.get("GEMINI_API_KEY"):
            # Concatenate all docs for context (with truncation)
            full_text = "\n\n---\n\n".join(
                f"[{d.meeting_name} / {d.meeting_date}]\n{d.text[:50000]}"
                for d in request.documents
                if d.text.strip()
            )
            all_chunks = enrich_chunks_with_context(all_chunks, full_text)

        # 3. Build indices
        searcher.build_index(all_chunks)

        # 4. Search
        results = searcher.search(request.query, top_k=request.top_k)

        # 5. Format results
        chunk_results: list[ChunkResult] = []
        for r in results:
            doc = doc_metadata.get(r.chunk.index)
            chunk_results.append(ChunkResult(
                text=r.chunk.text,
                speaker=r.chunk.speaker,
                agenda_context=r.chunk.agenda_context,
                score=r.score,
                bm25_rank=r.bm25_rank,
                vector_rank=r.vector_rank,
                doc_id=doc.doc_id if doc else "",
                meeting_name=doc.meeting_name if doc else "",
                meeting_date=doc.meeting_date if doc else "",
            ))

        elapsed = (time.time() - start) * 1000

        # 6. Clear indices
        searcher.clear()

        logger.info(f"Search completed in {elapsed:.0f}ms, {len(chunk_results)} results")

        return SearchResponse(
            results=chunk_results,
            total_chunks=len(all_chunks),
            processing_time_ms=elapsed,
        )

    except Exception as e:
        searcher.clear()  # Clean up on error
        logger.exception("Search failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok", "model_loaded": searcher._model is not None}


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("SEARCH_SERVICE_PORT", "8100"))
    uvicorn.run(app, host="0.0.0.0", port=port)

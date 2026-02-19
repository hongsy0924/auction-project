"""
In-Memory Hybrid Search Engine for Council Minutes.

Implements:
  - BM25 sparse search (via bm25s)
  - Dense vector search (via sentence-transformers + FAISS)
  - Reciprocal Rank Fusion (RRF) to merge results

All indices are ephemeral (RAM-only) — no persistent DB required.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

import bm25s
import faiss
import numpy as np
from sentence_transformers import SentenceTransformer

from chunker import Chunk

logger = logging.getLogger(__name__)

# ── Configuration ──────────────────────────────────────────────────────

# Multilingual embedding model — small but effective for Korean
EMBEDDING_MODEL_NAME = "intfloat/multilingual-e5-small"

# RRF constant (standard value from the original paper)
RRF_K = 60


@dataclass
class SearchResult:
    """A single search result with score and original chunk."""
    chunk: Chunk
    score: float
    bm25_rank: Optional[int] = None
    vector_rank: Optional[int] = None


class HybridSearcher:
    """
    Ephemeral in-memory hybrid searcher.

    Build an index from chunks, search with a query, then discard.
    Designed for single-request lifecycle in a stateless MCP server.
    """

    def __init__(self, model_name: str = EMBEDDING_MODEL_NAME):
        self._model_name = model_name
        self._model: Optional[SentenceTransformer] = None

        # Index state (populated by build_index)
        self._chunks: list[Chunk] = []
        self._bm25: Optional[bm25s.BM25] = None
        self._faiss_index: Optional[faiss.IndexFlatIP] = None
        self._embeddings: Optional[np.ndarray] = None

    @property
    def model(self) -> SentenceTransformer:
        """Lazy-load the embedding model (cached across requests)."""
        if self._model is None:
            logger.info(f"Loading embedding model: {self._model_name}")
            self._model = SentenceTransformer(self._model_name)
        return self._model

    def build_index(self, chunks: list[Chunk]) -> None:
        """
        Build ephemeral BM25 and FAISS indices from chunks.

        Args:
            chunks: List of Chunk objects to index.
        """
        if not chunks:
            logger.warning("No chunks to index")
            return

        self._chunks = chunks
        texts = [c.text for c in chunks]

        # ── BM25 Index ─────────────────────────────────────────────────
        logger.info(f"Building BM25 index for {len(texts)} chunks...")
        corpus_tokens = bm25s.tokenize(texts, stemmer=None)  # No stemmer for Korean
        self._bm25 = bm25s.BM25()
        self._bm25.index(corpus_tokens)

        # ── FAISS Vector Index ─────────────────────────────────────────
        logger.info(f"Building FAISS index for {len(texts)} chunks...")
        # Prefix for E5 models: "passage: " for documents, "query: " for queries
        prefixed = [f"passage: {t}" for t in texts]
        self._embeddings = self.model.encode(
            prefixed,
            normalize_embeddings=True,
            show_progress_bar=False,
            batch_size=64,
        )

        dim = self._embeddings.shape[1]
        self._faiss_index = faiss.IndexFlatIP(dim)  # Inner product = cosine on normalized vecs
        self._faiss_index.add(self._embeddings.astype(np.float32))

        logger.info(f"Indices built: {len(texts)} chunks, dim={dim}")

    def search(self, query: str, top_k: int = 10) -> list[SearchResult]:
        """
        Search using hybrid BM25 + vector approach with RRF fusion.

        Args:
            query: User query string.
            top_k: Number of top results to return.

        Returns:
            List of SearchResult objects, sorted by RRF score descending.
        """
        if not self._chunks or self._bm25 is None or self._faiss_index is None:
            return []

        n_chunks = len(self._chunks)
        # Search both indices for more candidates than needed
        search_k = min(n_chunks, top_k * 3)

        # ── BM25 Search ───────────────────────────────────────────────
        query_tokens = bm25s.tokenize([query], stemmer=None)
        bm25_results, bm25_scores = self._bm25.retrieve(
            query_tokens, corpus=list(range(n_chunks)), k=search_k
        )
        bm25_ranking = bm25_results[0].tolist()  # indices sorted by score

        # ── Vector Search ──────────────────────────────────────────────
        query_embedding = self.model.encode(
            [f"query: {query}"],
            normalize_embeddings=True,
            show_progress_bar=False,
        ).astype(np.float32)

        vec_scores, vec_indices = self._faiss_index.search(query_embedding, search_k)
        vec_ranking = vec_indices[0].tolist()

        # ── RRF Fusion ─────────────────────────────────────────────────
        rrf_scores: dict[int, float] = {}
        bm25_rank_map: dict[int, int] = {}
        vec_rank_map: dict[int, int] = {}

        for rank, idx in enumerate(bm25_ranking):
            if idx >= 0:  # FAISS may return -1 for empty results
                rrf_scores[idx] = rrf_scores.get(idx, 0) + 1 / (RRF_K + rank + 1)
                bm25_rank_map[idx] = rank

        for rank, idx in enumerate(vec_ranking):
            if idx >= 0:
                rrf_scores[idx] = rrf_scores.get(idx, 0) + 1 / (RRF_K + rank + 1)
                vec_rank_map[idx] = rank

        # Sort by RRF score, take top_k
        sorted_indices = sorted(rrf_scores, key=rrf_scores.__getitem__, reverse=True)[:top_k]

        # Build results
        results: list[SearchResult] = []
        for idx in sorted_indices:
            results.append(SearchResult(
                chunk=self._chunks[idx],
                score=rrf_scores[idx],
                bm25_rank=bm25_rank_map.get(idx),
                vector_rank=vec_rank_map.get(idx),
            ))

        return results

    def clear(self) -> None:
        """Release all index memory (garbage collection)."""
        self._chunks = []
        self._bm25 = None
        self._faiss_index = None
        self._embeddings = None
        logger.info("Indices cleared")

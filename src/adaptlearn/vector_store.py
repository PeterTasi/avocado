from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import ClassVar, Protocol

try:
    import chromadb
except Exception:  # pragma: no cover
    chromadb = None  # type: ignore[assignment]

from .models import Concept

logger = logging.getLogger("adaptlearn.vector_store")

# Collection names are scoped by embedding backend so vectors of different
# dimensionality never share a collection (ChromaDB default ONNX = 384 dims,
# Gemini text-embedding-004 = 768). Mixing dims in one collection errors.
_COLLECTION_LOCAL = "adaptlearn_concepts"
_COLLECTION_GEMINI = "adaptlearn_concepts_gemini"


class Embedder(Protocol):
    """Minimal interface the vector store needs from an embedding provider."""

    enabled: bool

    def embed_texts(self, texts: list[str]) -> list[list[float]] | None: ...


class ConceptVectorStore:
    _instances: ClassVar[dict[str, "ConceptVectorStore"]] = {}
    _clients: ClassVar[dict] = {}
    _lock: ClassVar[threading.Lock] = threading.Lock()

    def __new__(cls, storage_path: Path) -> "ConceptVectorStore":
        key = str(storage_path.resolve())
        with cls._lock:
            if key not in cls._instances:
                instance = super().__new__(cls)
                cls._instances[key] = instance
                instance._initialized = False
            return cls._instances[key]

    def __init__(self, storage_path: Path) -> None:
        if getattr(self, "_initialized", False):
            return

        self.storage_path = storage_path
        self.enabled = chromadb is not None
        self._embedder: Embedder | None = None

        if not self.enabled:
            self._initialized = True
            return

        self.storage_path.mkdir(parents=True, exist_ok=True)
        key = str(self.storage_path.resolve())
        if key not in ConceptVectorStore._clients:
            ConceptVectorStore._clients[key] = chromadb.PersistentClient(path=str(self.storage_path))
        self._initialized = True

    def set_embedder(self, embedder: Embedder | None) -> None:
        """Provide an embedding provider (e.g. the Gemini client).

        When the embedder is enabled, vectors are computed via its API and passed
        explicitly to ChromaDB, bypassing the heavy local ONNX model — the bottleneck
        that stalled big ingests on Render free tier. When absent/disabled, ChromaDB's
        default local embedding function is used instead.
        """
        self._embedder = embedder

    def _backend_active(self) -> bool:
        return self._embedder is not None and getattr(self._embedder, "enabled", False)

    def _get_collection(self):
        """Return the collection for the current embedding backend, or None."""
        if not self.enabled:
            return None
        key = str(self.storage_path.resolve())
        client = ConceptVectorStore._clients.get(key)
        if client is None:
            return None
        name = _COLLECTION_GEMINI if self._backend_active() else _COLLECTION_LOCAL
        return client.get_or_create_collection(name)

    def _embed(self, texts: list[str]) -> list[list[float]] | None:
        if not self._backend_active() or not self._embedder:
            return None
        return self._embedder.embed_texts(texts)

    def upsert_concepts(self, concepts: list[Concept], replace_existing: bool = False, course_id: str = "") -> None:
        if not self.enabled or not concepts:
            return
        collection = self._get_collection()
        if collection is None:
            return

        if replace_existing:
            existing = collection.get(include=[])
            existing_ids = existing.get("ids", [])
            if existing_ids:
                collection.delete(ids=existing_ids)

        ids = [concept.id for concept in concepts]
        docs = [f"{concept.name}. {concept.description}" for concept in concepts]
        metadatas = [
            {"chapter": concept.chapter, "name": concept.name, "course_id": course_id or "default"}
            for concept in concepts
        ]

        embeddings = self._embed(docs)
        if self._backend_active() and embeddings is None:
            # The Gemini collection stores 768-dim vectors and must be queried/written
            # with explicit embeddings. If embedding failed, writing text would let
            # ChromaDB fall back to its 384-dim local model → dimension clash. Skip the
            # vector upsert this round (best-effort; cross-course links degrade, ingest
            # still succeeds — concepts/graph are already in PostgreSQL).
            logger.warning(
                "Gemini embedding unavailable; skipping vector upsert for %d concept(s).",
                len(concepts),
            )
            return

        if embeddings is not None:
            collection.upsert(ids=ids, documents=docs, metadatas=metadatas, embeddings=embeddings)
        else:
            collection.upsert(ids=ids, documents=docs, metadatas=metadatas)

    def query_related(self, query: str, n_results: int = 5, exclude_course_id: str = "") -> list[dict]:
        if not self.enabled or not query.strip():
            return []
        collection = self._get_collection()
        if collection is None:
            return []

        if self._backend_active():
            vectors = self._embed([query])
            if not vectors:
                return []
            raw = collection.query(query_embeddings=vectors, n_results=n_results)
        else:
            raw = collection.query(query_texts=[query], n_results=n_results)
        raw_ids = raw.get("ids") or []
        raw_metadatas = raw.get("metadatas") or []
        raw_distances = raw.get("distances") or []
        ids = raw_ids[0] if raw_ids else []
        metadatas = raw_metadatas[0] if raw_metadatas else []
        distances = raw_distances[0] if raw_distances else []

        output: list[dict] = []
        for index, concept_id in enumerate(ids):
            metadata = metadatas[index] if index < len(metadatas) else {}
            distance = distances[index] if index < len(distances) else None
            result_course = metadata.get("course_id", "")
            if exclude_course_id and result_course == exclude_course_id:
                continue
            output.append(
                {
                    "concept_id": concept_id,
                    "name": metadata.get("name", concept_id),
                    "chapter": metadata.get("chapter", "Unknown"),
                    "course_id": result_course,
                    "distance": distance,
                }
            )
        return output

    def query_cross_course(self, concept_name: str, concept_description: str,
                           source_course_id: str, n_results: int = 5,
                           similarity_threshold: float = 0.82) -> list[dict]:
        """Find concepts from other courses that are semantically similar."""
        if not self.enabled:
            return []

        query_text = f"{concept_name}. {concept_description}"
        results = self.query_related(
            query=query_text,
            n_results=n_results + 3,  # fetch extra to compensate for filtering
            exclude_course_id=source_course_id,
        )

        cross_links: list[dict] = []
        for result in results:
            if result.get("distance") is not None:
                # ChromaDB distance: lower = more similar; convert to similarity
                similarity = max(0.0, 1.0 - result["distance"])
                if similarity >= similarity_threshold:
                    cross_links.append({**result, "similarity": round(similarity, 4)})

        return cross_links[:n_results]

    def delete_course(self, course_id: str) -> None:
        """Remove all vectors belonging to a single course."""
        if not self.enabled or not course_id:
            return
        collection = self._get_collection()
        if collection is None:
            return
        collection.delete(where={"course_id": course_id})

    def close(self) -> None:
        """Release singleton resources for this instance."""
        key = str(self.storage_path.resolve())
        with self._lock:
            self._instances.pop(key, None)
            self._clients.pop(key, None)
        self._embedder = None
        self._initialized = False

    @classmethod
    def reset_singleton(cls, storage_path: Path | None = None) -> None:
        with cls._lock:
            if storage_path:
                key = str(storage_path.resolve())
                cls._instances.pop(key, None)
                cls._clients.pop(key, None)
            else:
                cls._instances.clear()
                cls._clients.clear()

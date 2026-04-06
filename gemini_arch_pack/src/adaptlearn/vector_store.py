from __future__ import annotations

from pathlib import Path
from typing import ClassVar

try:
    import chromadb
except Exception:  # pragma: no cover
    chromadb = None  # type: ignore[assignment]

from .models import Concept


class ConceptVectorStore:
    _instances: ClassVar[dict[str, "ConceptVectorStore"]] = {}
    _clients: ClassVar[dict] = {}

    def __new__(cls, storage_path: Path) -> "ConceptVectorStore":
        key = str(storage_path.resolve())
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
        self._collection = None

        if not self.enabled:
            self._initialized = True
            return

        self.storage_path.mkdir(parents=True, exist_ok=True)
        key = str(self.storage_path.resolve())
        if key not in ConceptVectorStore._clients:
            ConceptVectorStore._clients[key] = chromadb.PersistentClient(path=str(self.storage_path))
        self._collection = ConceptVectorStore._clients[key].get_or_create_collection("adaptlearn_concepts")
        self._initialized = True

    def upsert_concepts(self, concepts: list[Concept], replace_existing: bool = False) -> None:
        if not self.enabled or not self._collection or not concepts:
            return

        if replace_existing:
            existing = self._collection.get(include=[])
            existing_ids = existing.get("ids", [])
            if existing_ids:
                self._collection.delete(ids=existing_ids)

        ids = [concept.id for concept in concepts]
        docs = [f"{concept.name}. {concept.description}" for concept in concepts]
        metadatas = [{"chapter": concept.chapter, "name": concept.name} for concept in concepts]
        self._collection.upsert(ids=ids, documents=docs, metadatas=metadatas)

    def query_related(self, query: str, n_results: int = 5) -> list[dict]:
        if not self.enabled or not self._collection or not query.strip():
            return []

        raw = self._collection.query(query_texts=[query], n_results=n_results)
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
            output.append(
                {
                    "concept_id": concept_id,
                    "name": metadata.get("name", concept_id),
                    "chapter": metadata.get("chapter", "Unknown"),
                    "distance": distance,
                }
            )
        return output

    @classmethod
    def reset_singleton(cls, storage_path: Path | None = None) -> None:
        if storage_path:
            key = str(storage_path.resolve())
            cls._instances.pop(key, None)
            if key in cls._clients:
                del cls._clients[key]
        else:
            cls._instances.clear()
            cls._clients.clear()

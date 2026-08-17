"""Tests for the vector-store/database sync guard (待辦 L1).

What happened: `reset_learning_state()` cleared the concepts table but not ChromaDB,
and `ingest_material` upserted vectors without first dropping the course's previous
ones. The index ended up holding 80 concepts the database no longer had, so a real
ingest produced 65 cross-course edges of which **none** could be resolved to a concept.

The guard makes the database the source of truth: a similarity match whose target no
longer exists is dropped before anything is persisted, whatever caused the drift.
"""

from __future__ import annotations

import logging
import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = PROJECT_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from adaptlearn.cross_course_linker import find_cross_course_links
from adaptlearn.models import Concept


class _StubVectorStore:
    """Returns matches for concepts that may or may not exist in the database."""

    def __init__(self, matches: list[dict]) -> None:
        self._matches = matches

    def query_cross_course(self, **_kwargs) -> list[dict]:
        return self._matches


class _StubRepo:
    def __init__(self, existing_ids: set[str]) -> None:
        self._existing = existing_ids
        self.saved: list = []

    def filter_existing_concept_ids(self, concept_ids: list[str]) -> set[str]:
        return {cid for cid in concept_ids if cid in self._existing}

    def save_cross_course_edges(self, edges) -> None:
        self.saved.extend(edges)


def _concept(cid: str = "c-new") -> Concept:
    return Concept(
        id=cid, name="特徵向量", chapter="第五章", description="", prerequisites=[]
    )


class SyncGuardTest(unittest.TestCase):
    def test_ghost_matches_are_never_persisted(self) -> None:
        store = _StubVectorStore(
            [
                {"concept_id": "c-ghost-1", "similarity": 0.91, "name": "幽靈一"},
                {"concept_id": "c-ghost-2", "similarity": 0.88, "name": "幽靈二"},
            ]
        )
        repo = _StubRepo(existing_ids=set())  # database has neither

        with self.assertLogs("adaptlearn.cross_course", level=logging.WARNING) as logs:
            edges = find_cross_course_links(
                new_concepts=[_concept()],
                course_id="crs-new",
                vector_store=store,
                repo=repo,
            )

        self.assertEqual(edges, [])
        self.assertEqual(repo.saved, [], "ghost edges must not reach the database")
        self.assertTrue(any("out of sync" in line for line in logs.output))

    def test_real_matches_still_persist(self) -> None:
        store = _StubVectorStore(
            [{"concept_id": "c-real", "similarity": 0.79, "name": "主成分分析"}]
        )
        repo = _StubRepo(existing_ids={"c-real"})

        edges = find_cross_course_links(
            new_concepts=[_concept()],
            course_id="crs-new",
            vector_store=store,
            repo=repo,
        )

        self.assertEqual(len(edges), 1)
        self.assertEqual(edges[0].to_concept_id, "c-real")
        self.assertEqual(len(repo.saved), 1)

    def test_mixed_results_keep_only_the_resolvable_ones(self) -> None:
        store = _StubVectorStore(
            [
                {"concept_id": "c-real", "similarity": 0.90, "name": "真的"},
                {"concept_id": "c-ghost", "similarity": 0.85, "name": "幽靈"},
            ]
        )
        repo = _StubRepo(existing_ids={"c-real"})

        edges = find_cross_course_links(
            new_concepts=[_concept()],
            course_id="crs-new",
            vector_store=store,
            repo=repo,
        )

        self.assertEqual([e.to_concept_id for e in edges], ["c-real"])
        self.assertEqual(len(repo.saved), 1)


if __name__ == "__main__":
    unittest.main()

"""Regression tests for the cross-course semantic bridge (Module D).

These pin the three faults that made the feature silently return nothing:
  1. the ChromaDB collection defaulted to squared-L2 while `query_cross_course`
     converted distance with `1 - distance` (only valid for cosine);
  2. the source course was filtered out *after* the top-N fetch, so same-course
     neighbours crowded every cross-course hit out of the result set;
  3. the similarity threshold was calibrated for a different embedding model
     and admitted only near-synonyms.

A fake embedder keeps the test offline — no Gemini API, no network.
"""

from __future__ import annotations

import math
import unittest

from adaptlearn.cross_course_linker import _infer_link_type
from adaptlearn.models import Concept
from adaptlearn.vector_store import _CROSS_COURSE_THRESHOLD, ConceptVectorStore

try:
    import chromadb
except Exception:  # pragma: no cover
    chromadb = None


def _unit(vec: list[float]) -> list[float]:
    norm = math.sqrt(sum(v * v for v in vec))
    return [v / norm for v in vec]


# Three unit vectors in the xy-plane. Angles are chosen so the cosine
# similarities straddle the threshold in a way we can assert exactly.
_VECTORS = {
    # course A
    "a-eigen": _unit([1.0, 0.0, 0.0]),
    # course B: ~0.94 similarity to a-eigen -> well above threshold
    "b-pca": _unit([1.0, 0.35, 0.0]),
    # course B: ~0.32 similarity to a-eigen -> well below threshold
    "b-tree": _unit([0.34, 1.0, 0.0]),
}


class _FakeEmbedder:
    """Deterministic embedder: looks vectors up by the concept name in the text."""

    enabled = True

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        out = []
        for text in texts:
            for key, vec in _VECTORS.items():
                if key in text:
                    out.append(vec)
                    break
            else:  # pragma: no cover - guards against a typo'd fixture
                raise AssertionError(f"no fake vector for: {text!r}")
        return out


def _concept(cid: str) -> Concept:
    return Concept(id=cid, name=cid, description=f"{cid} description", chapter="ch")


@unittest.skipIf(chromadb is None, "chromadb not installed")
class CrossCourseLinkTests(unittest.TestCase):
    def setUp(self) -> None:
        import tempfile
        from pathlib import Path

        self._tmp = tempfile.TemporaryDirectory()
        self.store = ConceptVectorStore(Path(self._tmp.name) / "chroma")
        self.store.set_embedder(_FakeEmbedder())
        self.store.upsert_concepts([_concept("a-eigen")], course_id="course-a")
        self.store.upsert_concepts(
            [_concept("b-pca"), _concept("b-tree")], course_id="course-b"
        )

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_collection_uses_cosine_space(self) -> None:
        """`1 - distance` is only a similarity under cosine distance."""
        metadata = self.store._get_collection().metadata
        self.assertEqual(metadata.get("hnsw:space"), "cosine")

    def test_source_course_excluded_by_the_search_itself(self) -> None:
        """Asking for a single neighbour must still skip past the source course."""
        rows = self.store.query_related(
            query="a-eigen description", n_results=1, exclude_course_id="course-a"
        )
        self.assertTrue(rows, "expected a cross-course neighbour, got none")
        self.assertTrue(all(r["course_id"] == "course-b" for r in rows))

    def test_related_concept_links_and_unrelated_one_does_not(self) -> None:
        links = self.store.query_cross_course(
            concept_name="a-eigen",
            concept_description="a-eigen description",
            source_course_id="course-a",
            n_results=5,
        )
        names = {link["name"] for link in links}
        self.assertIn("b-pca", names)
        self.assertNotIn("b-tree", names)

    def test_threshold_admits_real_cross_domain_pairs(self) -> None:
        """0.82 (the old value) sat above every genuine cross-domain match."""
        self.assertLess(_CROSS_COURSE_THRESHOLD, 0.75)
        self.assertGreater(_CROSS_COURSE_THRESHOLD, 0.60)

    def test_link_type_tiers_are_reachable(self) -> None:
        """Tiers must map onto the observed similarity range, not sit above it."""
        self.assertEqual(_infer_link_type(0.90), "equivalent")
        self.assertEqual(_infer_link_type(0.78), "generalization")
        self.assertEqual(_infer_link_type(0.73), "analogy")
        self.assertEqual(_infer_link_type(0.69), "semantic")


if __name__ == "__main__":  # pragma: no cover
    unittest.main()

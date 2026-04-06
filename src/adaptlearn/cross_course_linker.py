"""Module D: Cross-Course Semantic Linker (跨課程語義橋).

After a new course's knowledge graph is built, this module scans the vector
store for semantically similar concepts in *other* courses and creates
cross-course bridge edges.
"""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from .models import Concept, CrossCourseEdge

if TYPE_CHECKING:
    from .database import StudyRepository
    from .vector_store import ConceptVectorStore

logger = logging.getLogger("adaptlearn.cross_course")


def find_cross_course_links(
    new_concepts: list[Concept],
    course_id: str,
    vector_store: ConceptVectorStore,
    repo: StudyRepository,
    similarity_threshold: float = 0.82,
    max_links_per_concept: int = 3,
) -> list[CrossCourseEdge]:
    """Discover semantic bridges between *new_concepts* and existing courses.

    For each concept in the newly ingested course, query the vector store
    for similar concepts that belong to a *different* course.  When the
    cosine similarity exceeds ``similarity_threshold``, a cross-course
    edge is created and persisted.
    """
    if not new_concepts:
        return []

    edges: list[CrossCourseEdge] = []
    seen_pairs: set[tuple[str, str]] = set()

    for concept in new_concepts:
        matches = vector_store.query_cross_course(
            concept_name=concept.name,
            concept_description=concept.description,
            source_course_id=course_id,
            n_results=max_links_per_concept,
            similarity_threshold=similarity_threshold,
        )

        for match in matches:
            pair = tuple(sorted([concept.id, match["concept_id"]]))
            if pair in seen_pairs:
                continue
            seen_pairs.add(pair)

            edge = CrossCourseEdge(
                from_concept_id=concept.id,
                to_concept_id=match["concept_id"],
                similarity=match["similarity"],
                link_type=_infer_link_type(match["similarity"]),
            )
            edges.append(edge)
            logger.info(
                "Cross-course link: %s → %s (sim=%.3f, type=%s)",
                concept.name,
                match.get("name", match["concept_id"]),
                match["similarity"],
                edge.link_type,
            )

    if edges:
        repo.save_cross_course_edges(edges)
        logger.info("Saved %d cross-course edges for course %s", len(edges), course_id)

    return edges


def _infer_link_type(similarity: float) -> str:
    """Classify bridge type based on similarity score."""
    if similarity >= 0.95:
        return "equivalent"
    if similarity >= 0.90:
        return "generalization"
    if similarity >= 0.85:
        return "analogy"
    return "semantic"

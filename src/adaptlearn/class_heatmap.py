"""Module E: Class Heatmap (班級盲點熱力圖).

Aggregate student attempt data per concept to produce a class-level
understanding score.  Teachers can visualise this as a heatmap over the
knowledge graph (green = understood, red = stuck).
"""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from .models import ClassNodeStats

if TYPE_CHECKING:
    from .database import StudyRepository

logger = logging.getLogger("adaptlearn.class_heatmap")


def compute_class_heatmap(
    course_id: str,
    repo: StudyRepository,
) -> list[ClassNodeStats]:
    """Recompute and persist class-level stats for a course.

    Returns a list ordered by error_rate descending (worst first).
    """
    stats = repo.update_class_node_stats(course_id)
    logger.info(
        "Heatmap: course=%s, concepts=%d, worst_error=%.2f",
        course_id,
        len(stats),
        stats[0].error_rate if stats else 0.0,
    )
    return stats


def get_weak_concepts(
    course_id: str,
    repo: StudyRepository,
    top_n: int = 3,
    error_threshold: float = 0.5,
    uplift_cap: float = 0.23,
    uplift_ratio: float = 0.35,
) -> list[dict]:
    """Return the top-N concepts the class struggles with most.

    Useful for generating teacher recommendations like
    "focus on these 3 concepts next week".
    uplift_cap and uplift_ratio are configurable via Settings.
    """
    all_stats = repo.list_class_node_stats(course_id)
    weak = [s for s in all_stats if s.error_rate >= error_threshold and s.sample_count > 0]
    names = {c.id: c.name for c in repo.list_concepts(course_id)}

    results: list[dict] = []
    for stat in weak[:top_n]:
        estimated_uplift = round(min(uplift_cap, stat.error_rate * uplift_ratio), 3)
        results.append({
            "concept_id": stat.concept_id,
            "concept_name": names.get(stat.concept_id, stat.concept_id),
            "error_rate": stat.error_rate,
            "sample_count": stat.sample_count,
            "estimated_uplift": estimated_uplift,
        })
    return results

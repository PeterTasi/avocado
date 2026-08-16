"""Tests for the display-ready cross-course edge query (待辦 F).

Two things are pinned here:

  1. `list_cross_course_edges_detailed` resolves both ends to concept and course
     names. The plain `list_cross_course_edges` returns bare IDs, which a UI cannot
     resolve — /api/concepts is scoped to the active course, so the far end of a
     bridge is unreachable from the client.
  2. Edges whose concepts no longer exist are dropped rather than rendered as
     dangling IDs. The local demo DB had accumulated 63 such rows because
     `reset_learning_state` deleted concepts without deleting cross_course_edges;
     that gap is also covered below.

Every row this module writes carries a unique suffix and is removed in teardown,
so it never disturbs demo data living in the same local database.
"""

from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = PROJECT_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from db_guard import require_safe_db
from adaptlearn.database import StudyRepository
from adaptlearn.models import Concept, Course, CrossCourseEdge

pytestmark = pytest.mark.skipif(
    not os.getenv("DATABASE_URL"), reason="needs DATABASE_URL"
)


@pytest.fixture
def fixture_db():
    require_safe_db()
    repo = StudyRepository(os.environ["DATABASE_URL"])
    repo.initialize()

    tag = uuid.uuid4().hex[:8]
    course_a = f"crs-a-{tag}"
    course_b = f"crs-b-{tag}"
    concept_a = f"c-a-{tag}"
    concept_b = f"c-b-{tag}"

    for cid, subject in ((course_a, f"線性代數-{tag}"), (course_b, f"機器學習-{tag}")):
        repo.save_course(
            Course(
                id=cid,
                user_id="default",
                subject=subject,
                filename=f"{subject}.txt",
                uploaded_at=datetime.now(timezone.utc),
            )
        )
    repo.upsert_concepts(
        [
            Concept(
                id=concept_a,
                name="特徵向量",
                chapter="第五章",
                description="",
                prerequisites=[],
                course_id=course_a,
            ),
            Concept(
                id=concept_b,
                name="主成分分析",
                chapter="降維",
                description="",
                prerequisites=[],
                course_id=course_b,
            ),
        ]
    )
    repo.save_cross_course_edges(
        [CrossCourseEdge(concept_a, concept_b, similarity=0.79, link_type="analogy")]
    )

    yield (
        repo,
        {
            "course_a": course_a,
            "course_b": course_b,
            "concept_a": concept_a,
            "concept_b": concept_b,
        },
    )

    with repo._connect() as cur:
        cur.execute(
            "DELETE FROM cross_course_edges WHERE from_concept_id = %s OR to_concept_id = %s",
            (concept_a, concept_a),
        )
        cur.execute("DELETE FROM concepts WHERE id IN (%s, %s)", (concept_a, concept_b))
        cur.execute("DELETE FROM courses WHERE id IN (%s, %s)", (course_a, course_b))
    repo.close()


def _find(rows, concept_id):
    return next((r for r in rows if r["from_concept_id"] == concept_id), None)


def test_both_ends_resolve_to_names(fixture_db):
    repo, ids = fixture_db
    row = _find(repo.list_cross_course_edges_detailed(), ids["concept_a"])
    assert row is not None
    assert row["from_concept_name"] == "特徵向量"
    assert row["to_concept_name"] == "主成分分析"
    assert row["from_course_name"].startswith("線性代數")
    assert row["to_course_name"].startswith("機器學習")
    # analogy is the band cross-domain bridges land in — the whole point of the card.
    assert row["link_type"] == "analogy"
    assert row["similarity"] == pytest.approx(0.79)


def test_scoping_keeps_edges_touching_either_end(fixture_db):
    repo, ids = fixture_db
    for course in (ids["course_a"], ids["course_b"]):
        rows = repo.list_cross_course_edges_detailed(course_id=course)
        assert _find(rows, ids["concept_a"]) is not None, (
            f"missing when scoped to {course}"
        )


def test_scoping_excludes_unrelated_course(fixture_db):
    repo, ids = fixture_db
    rows = repo.list_cross_course_edges_detailed(
        course_id=f"crs-unrelated-{uuid.uuid4().hex[:8]}"
    )
    assert _find(rows, ids["concept_a"]) is None


def test_edge_with_deleted_concept_is_dropped(fixture_db):
    repo, ids = fixture_db
    with repo._connect() as cur:
        cur.execute("DELETE FROM concepts WHERE id = %s", (ids["concept_b"],))
    rows = repo.list_cross_course_edges_detailed()
    assert _find(rows, ids["concept_a"]) is None, "dangling edge must not be displayed"


@pytest.mark.skipif(
    "adaptlearn_test" not in os.getenv("DATABASE_URL", ""),
    reason="reset_learning_state is a global wipe — only run against a dedicated test DB",
)
def test_global_reset_clears_cross_course_edges(fixture_db):
    """reset_learning_state used to leave orphaned edges behind — the source of the
    63 unresolvable rows found in the local demo database.

    This wipes every table it touches, so it is gated on a database whose name says
    it is disposable. Against the demo DB it skips rather than destroying demo data.
    """
    repo, _ = fixture_db
    repo.reset_learning_state()
    with repo._connect() as cur:
        cur.execute("SELECT COUNT(*) AS n FROM cross_course_edges")
        assert cur.fetchone()["n"] == 0

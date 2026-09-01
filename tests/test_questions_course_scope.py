"""`list_questions` must be scoped to one course, like every sibling query.

`list_concepts`, `list_edges`, `concept_score_summary` and `get_graphviz` all take
a `course_id` and are called with the active course. `list_questions` was the only
one left global, so the quiz page showed every course's questions mixed together —
and, because nothing ever loaded them, showed none at all until you pressed
"產生題目". Switching course could not change the quiz.

Rows written here carry a unique suffix and are removed in teardown, so they never
disturb demo data living in the same local database.
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
from adaptlearn.models import Concept, Course, Question

pytestmark = pytest.mark.skipif(
    not os.getenv("DATABASE_URL"), reason="needs DATABASE_URL"
)


@pytest.fixture
def two_courses_with_questions():
    require_safe_db()
    repo = StudyRepository(os.environ["DATABASE_URL"])
    repo.initialize()

    tag = uuid.uuid4().hex[:8]
    ids = {
        "course_a": f"crs-a-{tag}",
        "course_b": f"crs-b-{tag}",
        "concept_a": f"c-a-{tag}",
        "concept_b": f"c-b-{tag}",
        "question_a": f"q-a-{tag}",
        "question_b": f"q-b-{tag}",
    }

    for cid, subject in (
        (ids["course_a"], f"線性代數-{tag}"),
        (ids["course_b"], f"機率-{tag}"),
    ):
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
                id=ids["concept_a"],
                name=f"正交基底-{tag}",
                chapter="正交性",
                description="",
                prerequisites=[],
                course_id=ids["course_a"],
            ),
            Concept(
                id=ids["concept_b"],
                name=f"貝氏定理-{tag}",
                chapter="條件機率",
                description="",
                prerequisites=[],
                course_id=ids["course_b"],
            ),
        ]
    )

    repo.save_questions(
        [
            Question(
                id=ids["question_a"],
                concept_id=ids["concept_a"],
                concept_name=f"正交基底-{tag}",
                difficulty="basic",
                question_text="A 課的題目",
                answer_text="",
                rationale="",
            ),
            Question(
                id=ids["question_b"],
                concept_id=ids["concept_b"],
                concept_name=f"貝氏定理-{tag}",
                difficulty="basic",
                question_text="B 課的題目",
                answer_text="",
                rationale="",
            ),
        ]
    )

    yield repo, ids

    with repo._connect() as cur:
        cur.execute(
            "DELETE FROM questions WHERE id IN (%s, %s)",
            (ids["question_a"], ids["question_b"]),
        )
        cur.execute(
            "DELETE FROM concepts WHERE id IN (%s, %s)",
            (ids["concept_a"], ids["concept_b"]),
        )
        cur.execute(
            "DELETE FROM courses WHERE id IN (%s, %s)",
            (ids["course_a"], ids["course_b"]),
        )
    repo.close()


def test_scoped_to_course_a(two_courses_with_questions):
    repo, ids = two_courses_with_questions
    rows = repo.list_questions(limit=500, course_id=ids["course_a"])
    got = {q.id for q in rows}
    assert ids["question_a"] in got
    assert ids["question_b"] not in got, "另一門課的題目不該出現"


def test_scoped_to_course_b(two_courses_with_questions):
    repo, ids = two_courses_with_questions
    rows = repo.list_questions(limit=500, course_id=ids["course_b"])
    got = {q.id for q in rows}
    assert ids["question_b"] in got
    assert ids["question_a"] not in got, "另一門課的題目不該出現"


def test_no_course_id_returns_everything(two_courses_with_questions):
    """Omitting course_id keeps the old global behaviour — callers that do not
    care (and the existing API default) must not break."""
    repo, ids = two_courses_with_questions
    got = {q.id for q in repo.list_questions(limit=500)}
    assert {ids["question_a"], ids["question_b"]} <= got


def test_pipeline_uses_active_course(two_courses_with_questions):
    """The service must scope to the active course without the caller passing it —
    this is what makes switching course change the quiz."""
    from adaptlearn.config import Settings
    from adaptlearn.pipeline import AdaptLearnService

    _repo, ids = two_courses_with_questions
    service = AdaptLearnService(
        settings=Settings(database_url=os.environ["DATABASE_URL"])
    )
    try:
        # set_active_course is per-repo-instance in-memory state, so it must be set on
        # the service's own repo — exactly what POST /api/courses/{id}/activate does.
        service.repo.set_active_course(ids["course_a"])
        got = {q.id for q in service.list_questions(limit=500)}
        assert ids["question_a"] in got
        assert ids["question_b"] not in got

        service.repo.set_active_course(ids["course_b"])
        got = {q.id for q in service.list_questions(limit=500)}
        assert ids["question_b"] in got
        assert ids["question_a"] not in got
    finally:
        service.close()

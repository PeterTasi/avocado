"""`/api/courses` must say which course is active.

The active course lived only in the server's memory; nothing exposed it. So the
client kept its own guess in local React state, which meant:

  - "目前課程" showed 「通用課程」 on every page no matter which course was active
  - the 「使用中」 badge in 教材 was lost on reload
  - both were wrong again after switching course

Fixing it on the client alone would just move the guess. The server knows; it has
to say so.

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
from fastapi.testclient import TestClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = PROJECT_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from db_guard import require_safe_db
from adaptlearn.database import StudyRepository
from adaptlearn.models import Course
from webapp import main as web_main

pytestmark = pytest.mark.skipif(
    not os.getenv("DATABASE_URL"), reason="needs DATABASE_URL"
)


@pytest.fixture
def client_with_two_courses():
    require_safe_db()
    repo = StudyRepository(os.environ["DATABASE_URL"])
    repo.initialize()

    tag = uuid.uuid4().hex[:8]
    course_a = f"crs-a-{tag}"
    course_b = f"crs-b-{tag}"
    for cid, subject in ((course_a, f"線性代數-{tag}"), (course_b, f"機率-{tag}")):
        repo.save_course(
            Course(
                id=cid,
                user_id="default",
                subject=subject,
                filename=f"{subject}.txt",
                uploaded_at=datetime.now(timezone.utc),
            )
        )

    client = TestClient(web_main.app)
    yield client, {"a": course_a, "b": course_b, "tag": tag}

    with repo._connect() as cur:
        cur.execute("DELETE FROM courses WHERE id IN (%s, %s)", (course_a, course_b))
    repo.close()


def _by_id(payload, course_id):
    return next((c for c in payload["items"] if c["id"] == course_id), None)


def test_active_course_is_flagged(client_with_two_courses):
    client, ids = client_with_two_courses

    assert client.post(f"/api/courses/{ids['a']}/activate").status_code == 200
    body = client.get("/api/courses").json()

    assert _by_id(body, ids["a"])["is_active"] is True
    assert _by_id(body, ids["b"])["is_active"] is False


def test_flag_follows_the_switch(client_with_two_courses):
    client, ids = client_with_two_courses

    client.post(f"/api/courses/{ids['a']}/activate")
    client.post(f"/api/courses/{ids['b']}/activate")
    body = client.get("/api/courses").json()

    assert _by_id(body, ids["b"])["is_active"] is True
    assert _by_id(body, ids["a"])["is_active"] is False, (
        "切換後舊的那門課不能還標成使用中"
    )


def test_exactly_one_active(client_with_two_courses):
    client, ids = client_with_two_courses
    client.post(f"/api/courses/{ids['a']}/activate")
    body = client.get("/api/courses").json()
    assert sum(1 for c in body["items"] if c["is_active"]) == 1

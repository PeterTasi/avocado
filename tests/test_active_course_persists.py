"""目前課程要記在資料庫：後端重啟（＝新的 repo 實例）後不能掉回最新上傳的那門。"""
from __future__ import annotations

import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = PROJECT_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from db_guard import require_safe_db  # noqa: E402
from adaptlearn.database import StudyRepository  # noqa: E402
from adaptlearn.models import Course  # noqa: E402

pytestmark = pytest.mark.skipif(not os.getenv("DATABASE_URL"), reason="needs DATABASE_URL")


def test_active_course_survives_new_repo_instance():
    require_safe_db()
    url = os.environ["DATABASE_URL"]
    repo = StudyRepository(url)
    repo.initialize()
    tag = uuid.uuid4().hex[:8]
    older, newer = f"crs-old-{tag}", f"crs-new-{tag}"
    now = datetime.now(timezone.utc)
    try:
        repo.save_course(Course(id=older, user_id="default", subject=f"舊-{tag}", filename="a.txt",
                                uploaded_at=now - timedelta(days=1)))
        repo.save_course(Course(id=newer, user_id="default", subject=f"新-{tag}", filename="b.txt",
                                uploaded_at=now))
        repo.set_active_course(older)

        fresh = StudyRepository(url)  # 模擬重啟：沒有記憶體快取
        assert fresh.get_active_course_id() == older
        fresh.close()
    finally:
        for cid in (older, newer):
            repo.delete_course(cid)
        repo.close()

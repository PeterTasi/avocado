import os
import sys
import uuid
import pytest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = PROJECT_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from db_guard import require_safe_db
from adaptlearn.database import StudyRepository
from adaptlearn.models import ConceptDetail

pytestmark = pytest.mark.skipif(
    not os.getenv("DATABASE_URL"), reason="needs DATABASE_URL"
)


@pytest.fixture
def repo():
    require_safe_db()
    r = StudyRepository(os.environ["DATABASE_URL"])
    r.initialize()
    yield r
    r.close()


def test_save_and_get_concept_detail(repo):
    cid = f"c-test-{uuid.uuid4().hex[:8]}"
    detail = ConceptDetail(
        concept_id=cid, language="zh",
        definition="定義", key_points=["重點1", "重點2"],
        example="範例", common_mistakes="誤區", has_formula=True,
    )
    repo.save_concept_detail(detail)
    got = repo.get_concept_detail(cid, "zh")
    assert got is not None
    assert got.definition == "定義"
    assert got.key_points == ["重點1", "重點2"]
    assert got.has_formula is True
    assert repo.get_concept_detail(cid, "en") is None


def test_get_missing_returns_none(repo):
    assert repo.get_concept_detail("c-does-not-exist", "zh") is None

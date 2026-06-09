import pytest
from adaptlearn.models import Concept, ConceptDetail


class _FakeRepo:
    def __init__(self):
        self.saved = []
        self._concepts = [Concept(id="c-1", name="細胞膜運輸", chapter="細胞", description="物質進出細胞")]
        self._cache = {}

    def list_concepts(self, course_id=None):
        return self._concepts

    def get_concept_detail(self, concept_id, language):
        return self._cache.get((concept_id, language))

    def save_concept_detail(self, detail):
        self.saved.append(detail)
        self._cache[(detail.concept_id, detail.language)] = detail


class _FakeGemini:
    def __init__(self):
        self.calls = 0

    def generate_concept_detail(self, name, chapter, description, language):
        self.calls += 1
        return {"definition": f"{name}-{language}", "key_points": ["k"],
                "example": "e", "common_mistakes": "m", "has_formula": False}


def _service():
    from adaptlearn.pipeline import AdaptLearnService
    svc = AdaptLearnService.__new__(AdaptLearnService)  # bypass __init__
    svc.repo = _FakeRepo()
    svc.gemini = _FakeGemini()
    return svc


def test_generates_and_caches_on_miss():
    svc = _service()
    d = svc.get_or_generate_concept_detail("c-1", "zh")
    assert isinstance(d, ConceptDetail)
    assert d.definition == "細胞膜運輸-zh"
    assert svc.gemini.calls == 1
    svc.get_or_generate_concept_detail("c-1", "zh")
    assert svc.gemini.calls == 1  # second call served from cache


def test_unknown_concept_raises():
    svc = _service()
    with pytest.raises(ValueError):
        svc.get_or_generate_concept_detail("c-missing", "zh")


class _DegradedGemini:
    def __init__(self):
        self.calls = 0

    def generate_concept_detail(self, name, chapter, description, language):
        self.calls += 1
        return {"definition": description, "key_points": [], "example": "",
                "common_mistakes": "", "has_formula": False, "degraded": True}


def test_degraded_result_not_cached():
    svc = _service()
    svc.gemini = _DegradedGemini()
    d1 = svc.get_or_generate_concept_detail("c-1", "en")
    assert d1.degraded is True
    assert svc.repo.saved == []  # 降級不快取
    # 再次請求會重試（不走快取）
    svc.get_or_generate_concept_detail("c-1", "en")
    assert svc.gemini.calls == 2

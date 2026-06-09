from adaptlearn.gemini_client import GeminiClient


def _make_client_with_payload(monkeypatch, payload_str):
    client = GeminiClient(api_key="", model="x")
    client.enabled = True  # bypass real API
    monkeypatch.setattr(client, "_generate_content", lambda *_a, **_k: payload_str)
    return client


def test_generate_concept_detail_parses(monkeypatch):
    payload = (
        '{"definition":"細胞膜運輸是...","key_points":["被動運輸不耗能","主動運輸耗ATP"],'
        '"example":"腸道吸收葡萄糖","common_mistakes":"誤以為擴散不需蛋白質","has_formula":false}'
    )
    client = _make_client_with_payload(monkeypatch, payload)
    detail = client.generate_concept_detail(
        name="細胞膜運輸", chapter="細胞", description="物質進出細胞", language="zh"
    )
    assert detail["definition"].startswith("細胞膜運輸")
    assert detail["key_points"] == ["被動運輸不耗能", "主動運輸耗ATP"]
    assert detail["has_formula"] is False
    assert detail["degraded"] is False


def test_generate_concept_detail_degrades_on_empty(monkeypatch):
    client = _make_client_with_payload(monkeypatch, "")  # API 失敗回 ""
    detail = client.generate_concept_detail(
        name="X", chapter="Y", description="desc", language="en"
    )
    assert detail["definition"]
    assert detail["key_points"] == []
    assert detail["degraded"] is True

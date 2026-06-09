from adaptlearn.gemini_client import GeminiClient


def test_generate_questions_passes_language(monkeypatch):
    captured = {}
    client = GeminiClient(api_key="", model="x")
    client.enabled = True

    def fake_gen(prompt):
        captured["prompt"] = prompt
        return "[]"

    monkeypatch.setattr(client, "_generate_content", fake_gen)
    client.generate_questions(concepts=[{"name": "X", "chapter": "Y", "description": "d"}],
                              per_concept=1, language="en")
    assert "English" in captured["prompt"]

    client.generate_questions(concepts=[{"name": "X", "chapter": "Y", "description": "d"}],
                              per_concept=1, language="both")
    assert "bilingual" in captured["prompt"].lower() or "中英" in captured["prompt"]

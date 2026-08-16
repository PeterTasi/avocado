"""Regression tests for topic-only ingest (待辦 J).

Topic mode's whole point is that it does NOT get its own pipeline: it generates a
handout and hands it to `ingest_material` as a .txt. So the only logic worth pinning
is what is unique to it — the guard on a failed/short generation, and the handoff
contract (filename, course_name, encoded bytes).

The service is built without __init__ so no database or vector store is touched.
"""

from __future__ import annotations

import unittest

from adaptlearn.pipeline import AdaptLearnService

_GOOD_OUTLINE = "正交性是內積為零的兩個向量之間的關係。" * 20


class _FakeGemini:
    def __init__(self, text: str = "", enabled: bool = True, error: str = "") -> None:
        self._text = text
        self._error = error
        self.enabled = enabled
        self.last_error = ""

    def generate_topic_material(self, topic: str) -> str:
        # The real client records failures on last_error during the call, and
        # ingest_topic clears it beforehand — so set it here, not in __init__.
        self.last_error = self._error
        return self._text


def _service(gemini: _FakeGemini) -> AdaptLearnService:
    service = object.__new__(AdaptLearnService)
    service.gemini = gemini
    return service


class TopicIngestTest(unittest.TestCase):
    def test_delegates_to_ingest_material_as_txt(self) -> None:
        service = _service(_FakeGemini(_GOOD_OUTLINE))
        captured: dict[str, object] = {}

        def fake_ingest(**kwargs):
            captured.update(kwargs)
            return {
                "course_id": "abc123",
                "concept_count": 7,
                "ingest_mode": "text-extraction",
            }

        service.ingest_material = fake_ingest

        result = service.ingest_topic("線性代數的正交性")

        # .txt keeps extract_material_text on the plain-decode path — no OCR, no vision quota.
        self.assertEqual(captured["file_name"], "線性代數的正交性.txt")
        self.assertEqual(captured["course_name"], "線性代數的正交性")
        self.assertEqual(captured["file_bytes"], _GOOD_OUTLINE.encode("utf-8"))
        # The upload path's own mode label must not leak into topic results.
        self.assertEqual(result["ingest_mode"], "topic-generated")
        self.assertEqual(result["topic"], "線性代數的正交性")
        self.assertEqual(result["concept_count"], 7)

    def test_blank_topic_rejected(self) -> None:
        service = _service(_FakeGemini(_GOOD_OUTLINE))
        with self.assertRaises(ValueError):
            service.ingest_topic("   ")

    def test_missing_api_key_names_the_key_not_the_file(self) -> None:
        service = _service(_FakeGemini("", enabled=False))
        with self.assertRaises(ValueError) as ctx:
            service.ingest_topic("正交性")
        # Must not fall through to ingest_material's "這份檔案幾乎沒有可讀文字".
        self.assertIn("金鑰", str(ctx.exception))

    def test_quota_error_is_surfaced(self) -> None:
        service = _service(_FakeGemini("", error="429 RESOURCE_EXHAUSTED"))
        with self.assertRaises(ValueError) as ctx:
            service.ingest_topic("正交性")
        self.assertIn("RESOURCE_EXHAUSTED", str(ctx.exception))

    def test_short_generation_is_not_ingested(self) -> None:
        service = _service(_FakeGemini("正交性很重要。"))

        def fail(**kwargs):
            raise AssertionError("ingest_material must not run on a too-short handout")

        service.ingest_material = fail
        with self.assertRaises(ValueError):
            service.ingest_topic("正交性")


if __name__ == "__main__":
    unittest.main()

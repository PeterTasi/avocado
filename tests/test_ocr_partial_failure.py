"""Tests for partial-OCR detection (待辦 L).

The failure these pin actually happened: a 14-page handwritten PDF produced text for
page 1 only — the vision model returned empty responses for pages 2-14 — and the
ingest reported `ocr_failed: false` with 4 concepts. 285 characters cleared the
40-character `low_text_mode` bar, so nothing downstream noticed that 93% of the
material was missing.

Two behaviours are covered:
  1. OllamaClient counts and logs pages that transcribe to nothing.
  2. The pipeline flags the result when too few pages made it through, while still
     keeping whatever concepts were extracted.
"""

from __future__ import annotations

import logging
import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = PROJECT_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from adaptlearn.ollama_client import OllamaClient, _is_prompt_echo
from adaptlearn.pdf_parser import ExtractedMaterial
from adaptlearn.pipeline import _OCR_MIN_PAGE_RATIO


class _StubOllama(OllamaClient):
    """Transcribes only the pages listed in `good_pages`; the rest come back empty,
    exactly as the real client does when the model burns its budget on thinking."""

    def __init__(self, good_pages: set[int]) -> None:
        super().__init__(model="stub-vl:7b")
        self._good = good_pages

    def _transcribe_one(self, image_bytes: bytes, prompt: str) -> str:  # type: ignore[override]
        self._page = getattr(self, "_page", 0) + 1
        if self._page in self._good:
            return f"page {self._page} text"
        self.last_error = "Ollama returned empty response."
        return ""


def _images(n: int) -> list[dict[str, object]]:
    return [{"data": b"fake-png-bytes", "label": f"page {i}"} for i in range(1, n + 1)]


class PageAccountingTest(unittest.TestCase):
    def test_counts_and_logs_empty_pages(self) -> None:
        client = _StubOllama(good_pages={1})
        with self.assertLogs("adaptlearn.ollama", level=logging.WARNING) as logs:
            text = client.transcribe_images(_images(14))

        self.assertEqual(client.pages_total, 14)
        self.assertEqual(client.pages_ok, 1)
        self.assertEqual(client.failed_pages, list(range(2, 15)))
        self.assertEqual(text, "page 1 text")
        # The summary line must name the shortfall, not just log per-page noise.
        self.assertTrue(
            any("1/14" in line for line in logs.output),
            f"expected a 1/14 summary in logs, got {logs.output[-1]}",
        )

    def test_all_pages_ok_reports_no_failures(self) -> None:
        client = _StubOllama(good_pages=set(range(1, 6)))
        text = client.transcribe_images(_images(5))
        self.assertEqual((client.pages_ok, client.pages_total), (5, 5))
        self.assertEqual(client.failed_pages, [])
        self.assertIn("page 5 text", text)


class ThresholdTest(unittest.TestCase):
    """The ratio logic as the pipeline applies it, without standing up a database."""

    @staticmethod
    def _flagged(material: ExtractedMaterial) -> bool:
        if not material.pages_total or material.pages_ok is None:
            return False
        return (material.pages_ok / material.pages_total) < _OCR_MIN_PAGE_RATIO

    def test_the_real_regression_is_flagged(self) -> None:
        # 1 of 14 pages — the case that shipped as "success".
        self.assertTrue(
            self._flagged(
                ExtractedMaterial(
                    "x" * 285, "pdf-ollama-ocr", True, pages_total=14, pages_ok=1
                )
            )
        )

    def test_mostly_complete_is_not_flagged(self) -> None:
        # 12 of 14 is incomplete but still worth studying from — must not be blocked.
        self.assertFalse(
            self._flagged(
                ExtractedMaterial(
                    "x" * 9000, "pdf-ollama-ocr", True, pages_total=14, pages_ok=12
                )
            )
        )

    def test_boundary_is_inclusive_at_the_threshold(self) -> None:
        # Exactly 60% passes; just under does not.
        self.assertFalse(
            self._flagged(
                ExtractedMaterial(
                    "x", "pdf-ollama-ocr", True, pages_total=10, pages_ok=6
                )
            )
        )
        self.assertTrue(
            self._flagged(
                ExtractedMaterial(
                    "x", "pdf-ollama-ocr", True, pages_total=10, pages_ok=5
                )
            )
        )

    def test_whole_document_paths_are_exempt(self) -> None:
        # Gemini's native-PDF path has no per-page notion of success; absent counts
        # must never be read as "0 pages succeeded".
        self.assertFalse(
            self._flagged(ExtractedMaterial("plenty of text", "pdf-ocr", True))
        )
        self.assertFalse(
            self._flagged(ExtractedMaterial("typed text", "pdf-text", False))
        )


class _EchoStubOllama(OllamaClient):
    """Returns canned per-page responses, in order, bypassing real HTTP."""

    def __init__(self, model: str, responses: list[str]) -> None:
        super().__init__(model=model)
        self._responses = responses

    def _transcribe_one(self, image_bytes: bytes, prompt: str) -> str:  # type: ignore[override]
        self._page = getattr(self, "_page", 0) + 1
        text = self._responses[self._page - 1]
        if not text:
            self.last_error = "Ollama returned empty response."
        return text


class PromptEchoTest(unittest.TestCase):
    """待辦 L2: a blank page has nothing to transcribe, so the model parrots the
    injected "Course context: ... Page label: ..." values back instead of
    transcribing — and that used to be counted as a successful page."""

    def test_pure_echo_is_treated_as_blank(self) -> None:
        course = "線性代數 8-1~8-3（手寫）"
        label = "PDF page 14"
        client = _EchoStubOllama("stub-vl:7b", [f"{course}\n{label}"])

        text = client.transcribe_images(
            [{"data": b"fake-png-bytes", "label": label}], course_name=course
        )

        self.assertEqual(client.pages_ok, 0)
        self.assertEqual(client.failed_pages, [1])
        self.assertEqual(text, "")

    def test_echo_plus_real_content_is_kept_in_full(self) -> None:
        course = "Linear Algebra"
        label = "page 1"
        real = f"{course}\n{label}\nAdjoint operator: <Tx, y> = <x, T*y>."
        client = _EchoStubOllama("stub-vl:7b", [real])

        text = client.transcribe_images(
            [{"data": b"fake-png-bytes", "label": label}], course_name=course
        )

        self.assertEqual(client.pages_ok, 1)
        self.assertEqual(text, real)  # untouched — not truncated to strip the echo

    def test_specialized_model_is_exempt_from_the_check(self) -> None:
        # glm-ocr's prompt has no injected context/label ("Text Recognition:" only),
        # so a course name in its output was actually written on the page.
        course = "線性代數 8-1~8-3（手寫）"
        client = _EchoStubOllama("glm-ocr", [course])

        text = client.transcribe_images(
            [{"data": b"fake-png-bytes", "label": "page 1"}], course_name=course
        )

        self.assertEqual(client.pages_ok, 1)
        self.assertEqual(text, course)


class IsPromptEchoUnitTest(unittest.TestCase):
    """Direct unit coverage of the residue-stripping logic itself."""

    def test_punctuation_and_whitespace_around_echo_do_not_survive(self) -> None:
        self.assertTrue(_is_prompt_echo("課程A\n頁 1", "課程A", "頁 1"))
        self.assertTrue(_is_prompt_echo("課程A。頁 1。", "課程A", "頁 1"))
        self.assertTrue(_is_prompt_echo("（課程A）「頁 1」", "課程A", "頁 1"))

    def test_any_real_content_survives(self) -> None:
        self.assertFalse(_is_prompt_echo("課程A\n頁 1\n定義：...", "課程A", "頁 1"))


if __name__ == "__main__":
    unittest.main()

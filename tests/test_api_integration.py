from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = PROJECT_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from adaptlearn.config import Settings
from adaptlearn.pipeline import AdaptLearnService
from webapp import main as web_main

_TEST_DB_URL = os.environ.get("DATABASE_URL", "postgresql://localhost/adaptlearn_test")


class _FakeVisionGemini:
    def __init__(self, transcription: str, records: list[dict[str, object]]) -> None:
        self.enabled = True
        self.transcription = transcription
        self.records = records

    def transcribe_images(self, images, course_name: str = "") -> str:
        return self.transcription

    def extract_concepts(self, text: str, course_name: str, max_concepts: int = 24) -> list[dict[str, object]]:
        return self.records


class AdaptLearnApiIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tempdir = tempfile.TemporaryDirectory()
        root = Path(self._tempdir.name)

        self._old_get_service = web_main._get_service

        settings = Settings(
            database_url=_TEST_DB_URL,
            chroma_path=root / "chroma",
            gemini_api_key="",
            gemini_model="gemini-flash-latest",
        )
        self._service = AdaptLearnService(settings=settings, api_key="")
        self._service.repo.initialize()
        self._service.repo.reset_learning_state(include_attempts=True)

        def _fake_get_service(api_key_override: str | None = None) -> AdaptLearnService:
            return self._service

        web_main._get_service = _fake_get_service
        web_main._cache.clear()
        web_main._cache_large.clear()

        self.client = TestClient(web_main.app)

    def tearDown(self) -> None:
        web_main._get_service = self._old_get_service
        web_main._cache.clear()
        web_main._cache_large.clear()
        self._tempdir.cleanup()

    def test_full_api_flow_generic_mode(self) -> None:
        text = (
            "Graph traversal includes breadth first search and depth first search. "
            "A queue supports BFS and a stack supports DFS. "
            "Shortest path can be solved by Dijkstra under non-negative weights. "
            "Dynamic programming uses recurrence, memoization, and tabulation."
        )

        ingest_response = self.client.post(
            "/api/material/ingest",
            files={"file": ("notes.txt", text.encode("utf-8"), "text/plain")},
            data={
                "course_name": "General Course",
                "template_mode": "generic",
                "api_key": "",
            },
        )
        self.assertEqual(ingest_response.status_code, 200)
        ingest_payload = ingest_response.json()
        self.assertTrue(bool(ingest_payload.get("ok")))
        self.assertEqual(ingest_payload.get("ingest_mode"), "text-extraction")

        diagnostics_response = self.client.post(
            "/api/diagnostics/generate",
            json={"question_count": 6},
        )
        self.assertEqual(diagnostics_response.status_code, 200)
        diagnostics_payload = diagnostics_response.json()
        questions = diagnostics_payload.get("items", [])
        self.assertEqual(len(questions), 6)

        first_question = questions[0]
        grade_response = self.client.post(
            f"/api/questions/{first_question['id']}/grade",
            json={"answer": first_question["answer_text"]},
        )
        self.assertEqual(grade_response.status_code, 200)
        grade_payload = grade_response.json()
        self.assertGreaterEqual(float(grade_payload.get("score", 0.0)), 0.6)

        recalc_response = self.client.post("/api/review/recalculate")
        self.assertEqual(recalc_response.status_code, 200)

        tonight_response = self.client.get("/api/tonight?top_n=3")
        self.assertEqual(tonight_response.status_code, 200)
        tonight_payload = tonight_response.json()
        self.assertIn("focus_items", tonight_payload)
        self.assertLessEqual(len(tonight_payload.get("focus_items", [])), 3)

    def test_low_text_is_rejected_in_generic_mode(self) -> None:
        response = self.client.post(
            "/api/material/ingest",
            files={"file": ("tiny.txt", b"a", "text/plain")},
            data={
                "course_name": "General Course",
                "template_mode": "generic",
                "api_key": "",
            },
        )

        self.assertEqual(response.status_code, 400)
        detail = response.json().get("detail", "")
        self.assertIn("幾乎沒有可讀文字", detail)

    def test_image_upload_uses_gemini_ocr_when_available(self) -> None:
        self._service.gemini = _FakeVisionGemini(
            transcription=(
                "Breadth first search uses a queue. "
                "Depth first search uses a stack or recursion."
            ),
            records=[
                {
                    "name": "Breadth First Search",
                    "chapter": "Graph Traversal",
                    "description": "Queue-based graph traversal.",
                    "prerequisites": [],
                },
                {
                    "name": "Depth First Search",
                    "chapter": "Graph Traversal",
                    "description": "Stack-based graph traversal.",
                    "prerequisites": ["Breadth First Search"],
                },
            ],
        )

        response = self.client.post(
            "/api/material/ingest",
            files={"file": ("handwritten.png", b"fake-image-bytes", "image/png")},
            data={
                "course_name": "Algorithms",
                "template_mode": "generic",
                "api_key": "",
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload.get("ingest_mode"), "ocr-transcription")
        self.assertTrue(bool(payload.get("ocr_used")))
        self.assertEqual(payload.get("source_type"), "image-ocr")


if __name__ == "__main__":
    unittest.main()

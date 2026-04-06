from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = PROJECT_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from adaptlearn.config import Settings
from adaptlearn.pipeline import AdaptLearnService


class AdaptLearnWorkflowTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tempdir = tempfile.TemporaryDirectory()
        root = Path(self._tempdir.name)

        settings = Settings(
            database_path=root / "adaptlearn_test.db",
            chroma_path=root / "chroma",
            gemini_api_key="",
            gemini_model="gemini-flash-latest",
        )
        self.service = AdaptLearnService(settings=settings, api_key="")

    def tearDown(self) -> None:
        self._tempdir.cleanup()

    def test_generic_ingest_diagnostics_grade_and_review(self) -> None:
        text = (
            "Graph traversal includes breadth first search and depth first search. "
            "A queue supports BFS and a stack supports DFS. "
            "Shortest path can be solved by Dijkstra under non-negative weights. "
            "Dynamic programming uses recurrence, memoization, and tabulation."
        )

        result = self.service.ingest_material(
            file_name="notes.txt",
            file_bytes=text.encode("utf-8"),
            course_name="General Course",
            template_mode="generic",
        )

        self.assertEqual(result["ingest_mode"], "text-extraction")
        self.assertFalse(bool(result["used_seed_template"]))
        self.assertGreater(int(result["concept_count"]), 0)

        questions = self.service.generate_diagnostics(question_count=6)
        self.assertEqual(len(questions), 6)

        first = questions[0]
        grade = self.service.grade_question(question_id=first.id, user_answer=first.answer_text)
        self.assertGreaterEqual(float(grade["score"]), 0.6)
        self.assertTrue(bool(grade["is_correct"]))

        review_items = self.service.build_and_save_review_plan()
        self.assertGreater(len(review_items), 0)

        tonight = self.service.get_tonight_study_dashboard(top_n=3)
        self.assertIn("focus_items", tonight)
        self.assertLessEqual(len(tonight["focus_items"]), 3)

    def test_generic_low_text_input_is_rejected(self) -> None:
        with self.assertRaises(ValueError) as context:
            self.service.ingest_material(
                file_name="tiny.txt",
                file_bytes=b"a",
                course_name="General Course",
                template_mode="generic",
            )

        self.assertIn("幾乎沒有可讀文字", str(context.exception))


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = PROJECT_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from db_guard import require_safe_db
from adaptlearn.config import Settings
from adaptlearn.models import Concept, Course
from adaptlearn.pipeline import AdaptLearnService

_TEST_DB_URL = os.environ.get("DATABASE_URL", "postgresql://localhost/adaptlearn_test")


class AdaptLearnWorkflowTests(unittest.TestCase):
    def setUp(self) -> None:
        require_safe_db()
        self._tempdir = tempfile.TemporaryDirectory()
        root = Path(self._tempdir.name)

        settings = Settings(
            database_url=_TEST_DB_URL,
            chroma_path=root / "chroma",
            gemini_api_key="",
            gemini_model="gemini-flash-latest",
        )
        self.service = AdaptLearnService(settings=settings, api_key="")
        # Reset state so tests don't bleed into each other
        self.service.repo.reset_learning_state(include_attempts=True)

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
        grade = self.service.grade_question(
            question_id=first.id, user_answer=first.answer_text
        )
        self.assertGreaterEqual(float(grade["score"]), 0.6)
        self.assertTrue(bool(grade["is_correct"]))

        review_items = self.service.get_review_plan()
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

    def test_review_plan_scoped_to_active_course(self) -> None:
        """待辦 G 回歸測試：review_plan 表被刪除、改即時計算後，兩門課的複習計畫
        不得互相污染——沒有持久化就沒有「重算 A 刪掉 B」這回事，但仍要驗證
        get_review_plan() 讀的是當前 active course 的概念，不是全域。"""
        repo = self.service.repo

        course_a = Course(id="course-a", subject="Course A")
        course_b = Course(id="course-b", subject="Course B")
        repo.save_course(course_a)
        repo.save_course(course_b)

        concept_a = Concept(
            id="concept-a",
            name="Concept A",
            chapter="Ch1",
            description="",
            course_id="course-a",
        )
        concept_b = Concept(
            id="concept-b",
            name="Concept B",
            chapter="Ch1",
            description="",
            course_id="course-b",
        )
        repo.upsert_concepts([concept_a])
        repo.upsert_concepts([concept_b])

        repo.set_active_course("course-a")
        plan_a = self.service.get_review_plan()
        self.assertEqual({item.concept_id for item in plan_a}, {"concept-a"})

        repo.set_active_course("course-b")
        plan_b = self.service.get_review_plan()
        self.assertEqual({item.concept_id for item in plan_b}, {"concept-b"})

        # 切回 A：沒有表可以被 B 的重算清空，A 的計畫理應原封不動地重新算出來
        repo.set_active_course("course-a")
        plan_a_again = self.service.get_review_plan()
        self.assertEqual({item.concept_id for item in plan_a_again}, {"concept-a"})


if __name__ == "__main__":
    unittest.main()

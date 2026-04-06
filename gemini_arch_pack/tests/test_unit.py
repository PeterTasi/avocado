from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = PROJECT_ROOT / "src"
import sys
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from adaptlearn.config import Settings
from adaptlearn.database import StudyRepository
from adaptlearn.knowledge_graph import build_knowledge_graph
from adaptlearn.models import Attempt, Concept, Question, ReviewItem
from adaptlearn.pipeline import AdaptLearnService
from datetime import datetime, timedelta


@pytest.fixture
def temp_dir():
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


@pytest.fixture
def settings(temp_dir):
    return Settings(
        database_path=temp_dir / "test.db",
        chroma_path=temp_dir / "chroma",
        gemini_api_key="",
        gemini_model="gemini-flash-latest",
    )


@pytest.fixture
def repo(settings):
    repo = StudyRepository(settings.database_path)
    repo.initialize()
    repo.reset_learning_state(include_attempts=True)
    yield repo
    repo.close()
    if hasattr(StudyRepository, "_local"):
        StudyRepository._local = type(StudyRepository._local)()


@pytest.fixture
def service(settings):
    from adaptlearn.vector_store import ConceptVectorStore
    ConceptVectorStore.reset_singleton(settings.chroma_path)
    svc = AdaptLearnService(settings=settings, api_key="")
    yield svc
    svc.repo.close()
    ConceptVectorStore.reset_singleton(settings.chroma_path)


class TestStudyRepository:
    def test_initialize_creates_tables(self, repo):
        repo.initialize()
        concepts = repo.list_concepts()
        assert concepts == []

    def test_upsert_and_list_concepts(self, repo):
        concept = Concept(
            id="test-1",
            name="Test Concept",
            chapter="Chapter 1",
            description="Test description",
            prerequisites=["prereq-1"],
        )
        repo.upsert_concepts([concept])
        concepts = repo.list_concepts()
        assert len(concepts) == 1
        assert concepts[0].id == "test-1"
        assert concepts[0].name == "Test Concept"

    def test_upsert_updates_existing_concept(self, repo):
        concept1 = Concept(
            id="test-1",
            name="Original Name",
            chapter="Chapter 1",
            description="Original description",
            prerequisites=[],
        )
        repo.upsert_concepts([concept1])

        concept2 = Concept(
            id="test-1",
            name="Updated Name",
            chapter="Chapter 2",
            description="Updated description",
            prerequisites=["new-prereq"],
        )
        repo.upsert_concepts([concept2])

        concepts = repo.list_concepts()
        assert len(concepts) == 1
        assert concepts[0].name == "Updated Name"
        assert concepts[0].chapter == "Chapter 2"

    def test_save_and_list_questions(self, repo):
        question = Question(
            id="q-1",
            concept_id="c-1",
            concept_name="Test",
            difficulty="medium",
            question_text="What is 2+2?",
            answer_text="4",
            rationale="Basic addition",
        )
        repo.save_questions([question])
        questions = repo.list_questions()
        assert len(questions) == 1
        assert questions[0].id == "q-1"
        assert questions[0].question_text == "What is 2+2?"

    def test_save_and_list_attempts(self, repo):
        attempt = Attempt(
            question_id="q-1",
            concept_id="c-1",
            user_answer="4",
            is_correct=True,
            score=1.0,
            feedback="Correct",
            created_at=datetime.now(),
        )
        repo.save_attempt(attempt)
        attempts = repo.list_attempts()
        assert len(attempts) == 1
        assert attempts[0].is_correct is True
        assert attempts[0].score == 1.0

    def test_save_and_list_review_plan(self, repo):
        item = ReviewItem(
            concept_id="c-1",
            concept_name="Test Concept",
            priority=0.8,
            next_review_at=datetime.now() + timedelta(days=1),
            suggested_slot="morning",
            reason="Test reason",
        )
        repo.save_review_plan([item])
        items = repo.list_review_plan()
        assert len(items) == 1
        assert items[0].concept_id == "c-1"
        assert items[0].priority == 0.8

    def test_get_metrics(self, repo):
        attempt = Attempt(
            question_id="q-1",
            concept_id="c-1",
            user_answer="4",
            is_correct=True,
            score=0.8,
            feedback="Good",
            created_at=datetime.now(),
        )
        repo.save_attempt(attempt)
        metrics = repo.get_metrics()
        assert metrics["attempt_count"] == 1.0
        assert metrics["avg_score"] == 0.8

    def test_reset_learning_state(self, repo):
        concept = Concept(
            id="test-1",
            name="Test",
            chapter="Chapter 1",
            description="Test",
            prerequisites=[],
        )
        repo.upsert_concepts([concept])
        repo.save_questions([
            Question(
                id="q-1",
                concept_id="c-1",
                concept_name="Test",
                difficulty="easy",
                question_text="?",
                answer_text="!",
                rationale=".",
            )
        ])
        repo.reset_learning_state(include_attempts=False)
        assert len(repo.list_concepts()) == 0
        assert len(repo.list_questions()) == 0


class TestAdaptLearnService:
    def test_ingest_low_text_with_template(self, service):
        result = service.ingest_material(
            file_name="tiny.txt",
            file_bytes=b"a",
            course_name="Linear Algebra",
            template_mode="linear-algebra",
        )
        assert result["ingest_mode"] == "template-fallback"
        assert result["used_seed_template"] is True
        assert result["concept_count"] > 0

    def test_ingest_text_extraction(self, service):
        text = (
            "Matrix matrix matrix multiplication is defined when the number of columns in A "
            "equals the number of rows in B. The result C has dimensions rows(A) by cols(B). "
            "Matrix operations include addition subtraction multiplication transpose inverse determinant. "
            "Linear linear linear algebra covers vector spaces eigenvalues eigenvectors transformations. "
            "Systems systems systems of equations can be solved using Gaussian elimination substitution. "
            "Orthogonal orthogonal matrices satisfy Q transpose Q equals identity identity. "
            "Eigenvalues eigenvalues satisfy the characteristic equation det(A minus lambda I) equals zero. "
            "Singular singular singular value decomposition decomposes a matrix into singular vectors values."
        )
        result = service.ingest_material(
            file_name="notes.txt",
            file_bytes=text.encode("utf-8"),
            course_name="Linear Algebra",
            template_mode="generic",
        )
        assert result["ingest_mode"] == "text-extraction"
        assert result["concept_count"] > 0

    def test_ingest_rejects_empty_text(self, service):
        with pytest.raises(ValueError) as exc_info:
            service.ingest_material(
                file_name="tiny.txt",
                file_bytes=b"a",
                course_name="General",
                template_mode="generic",
            )
        assert "幾乎沒有可讀文字" in str(exc_info.value)

    def test_list_concepts_after_ingest(self, service):
        text = (
            "Breadth breadth first search BFS BFS uses a queue queue queue data structure. "
            "Depth depth first search DFS DFS uses a stack or recursion to explore vertices. "
            "Graph graph algorithms include shortest path Dijkstra Bellman-Ford Floyd-Warshall. "
            "Dynamic dynamic programming DP DP uses memoization tabulation to solve overlapping subproblems. "
            "Binary binary search trees BST BST enable efficient search insertion deletion operations."
        )
        service.ingest_material(
            file_name="notes.txt",
            file_bytes=text.encode("utf-8"),
            course_name="Algorithms",
            template_mode="generic",
        )
        concepts = service.list_concepts()
        assert len(concepts) > 0
        assert all(hasattr(c, "name") for c in concepts)
        assert all(hasattr(c, "chapter") for c in concepts)

    def test_get_metrics(self, service):
        metrics = service.get_metrics()
        assert "concept_count" in metrics
        assert "attempt_count" in metrics
        assert "accuracy" in metrics

    def test_get_concept_mastery(self, service):
        mastery = service.get_concept_mastery()
        assert isinstance(mastery, list)

    def test_get_chapter_mastery(self, service):
        mastery = service.get_chapter_mastery()
        assert isinstance(mastery, list)

    def test_tonight_dashboard(self, service):
        dashboard = service.get_tonight_study_dashboard(top_n=3)
        assert "before" in dashboard
        assert "after" in dashboard
        assert "uplift" in dashboard
        assert "focus_items" in dashboard
        assert isinstance(dashboard["focus_items"], list)

    def test_get_graphviz(self, service):
        dot = service.get_graphviz()
        assert "digraph" in dot
        assert "ConceptGraph" in dot


class _FakeGeminiExtractor:
    def __init__(self, records):
        self.records = records

    def extract_concepts(self, text, course_name, max_concepts=24):
        return self.records


class TestKnowledgeGraphQuality:
    def test_filters_week_schedule_noise_from_llm_records(self):
        fake_client = _FakeGeminiExtractor(
            records=[
                {
                    "name": "Week 1",
                    "chapter": "Week 1",
                    "description": "課程介紹與作業規範",
                    "prerequisites": [],
                },
                {
                    "name": "Gaussian Elimination",
                    "chapter": "Linear Systems",
                    "description": "Row operations for solving Ax=b",
                    "prerequisites": [],
                },
            ]
        )

        concepts, _ = build_knowledge_graph(
            text="Week 1: course logistics. Gaussian elimination and row operations.",
            course_name="Linear Algebra",
            gemini_client=fake_client,
        )

        names = [concept.name.lower() for concept in concepts]
        assert "week 1" not in names
        assert "gaussian elimination" in names

    def test_does_not_force_next_chain_edges(self):
        fake_client = _FakeGeminiExtractor(
            records=[
                {
                    "name": "Vector Space",
                    "chapter": "Chapter 1",
                    "description": "Set with vector operations",
                    "prerequisites": [],
                },
                {
                    "name": "Linear Combination",
                    "chapter": "Chapter 1",
                    "description": "Build vectors from basis vectors",
                    "prerequisites": ["Vector Space"],
                },
                {
                    "name": "Basis",
                    "chapter": "Chapter 2",
                    "description": "Independent spanning set",
                    "prerequisites": ["Linear Combination"],
                },
            ]
        )

        _, edges = build_knowledge_graph(
            text="vector space linear combination basis",
            course_name="Linear Algebra",
            gemini_client=fake_client,
        )

        assert all(edge.relation != "next" for edge in edges)
        assert any(edge.relation == "prerequisite" for edge in edges)

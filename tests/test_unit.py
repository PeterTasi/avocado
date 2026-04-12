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

    def test_image_ingest_requires_ocr_provider(self, service):
        with pytest.raises(ValueError) as exc_info:
            service.ingest_material(
                file_name="handwritten.png",
                file_bytes=b"fake-image-bytes",
                course_name="General",
                template_mode="generic",
            )
        assert "Gemini API 金鑰" in str(exc_info.value)

    def test_image_ingest_uses_gemini_ocr(self, service):
        service.gemini = _FakeVisionGemini(
            transcription=(
                "Matrix multiplication combines rows and columns. "
                "Eigenvalues satisfy det(A - lambda I) = 0."
            ),
            records=[
                {
                    "name": "Matrix Multiplication",
                    "chapter": "Core Concepts",
                    "description": "Combine rows and columns to produce a new matrix.",
                    "prerequisites": [],
                },
                {
                    "name": "Eigenvalues",
                    "chapter": "Core Concepts",
                    "description": "Scalar values satisfying det(A - lambda I) = 0.",
                    "prerequisites": ["Matrix Multiplication"],
                },
            ],
        )

        result = service.ingest_material(
            file_name="handwritten.png",
            file_bytes=b"fake-image-bytes",
            course_name="Linear Algebra",
            template_mode="generic",
        )

        assert result["ingest_mode"] == "ocr-transcription"
        assert result["ocr_used"] is True
        assert result["source_type"] == "image-ocr"
        assert result["concept_count"] >= 2

    def test_scanned_pdf_uses_configurable_ocr_page_limit(self, temp_dir):
        import fitz

        settings = Settings(
            database_path=temp_dir / "test_limit.db",
            chroma_path=temp_dir / "chroma-limit",
            gemini_api_key="",
            gemini_model="gemini-flash-latest",
            max_ocr_pages=1,
        )
        service = AdaptLearnService(settings=settings, api_key="")
        service.gemini = _FakeVisionGemini(
            transcription="matrix multiplication eigenvalues",
            records=[
                {
                    "name": "Matrix Multiplication",
                    "chapter": "Core Concepts",
                    "description": "Combine rows and columns to produce a new matrix.",
                    "prerequisites": [],
                }
            ],
        )

        doc = fitz.open()
        doc.new_page()
        doc.new_page()
        pdf_bytes = doc.tobytes()
        doc.close()

        try:
            with pytest.raises(ValueError) as exc_info:
                service.ingest_material(
                    file_name="scan.pdf",
                    file_bytes=pdf_bytes,
                    course_name="Linear Algebra",
                    template_mode="generic",
                )
            assert "上限 1 頁" in str(exc_info.value)
        finally:
            service.close()

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


class _FakeVisionGemini:
    def __init__(self, transcription, records):
        self.enabled = True
        self.transcription = transcription
        self.records = records

    def transcribe_images(self, images, course_name=""):
        return self.transcription

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


class TestPdfSizeLimit:
    def test_pdf_size_limit_rejected(self, service):
        """Files larger than 20 MB should raise ValueError immediately."""
        from adaptlearn.pdf_parser import MAX_FILE_SIZE

        oversized = b"x" * (MAX_FILE_SIZE + 1)
        with pytest.raises(ValueError, match="20"):
            service.ingest_material(
                file_name="large.pdf",
                file_bytes=oversized,
                course_name="General",
                template_mode="generic",
            )


class TestConceptIdStability:
    def test_uuid5_ids_are_deterministic(self):
        """Same name+chapter always produces the same concept ID (UUID5)."""
        from adaptlearn.knowledge_graph import _concept_id  # type: ignore

        id1 = _concept_id("Eigenvalue", "Chapter 3")
        id2 = _concept_id("Eigenvalue", "Chapter 3")
        assert id1 == id2

    def test_different_chapters_give_different_ids(self):
        """'Rank' in Chapter 1 vs Chapter 2 must not share an ID."""
        from adaptlearn.knowledge_graph import _concept_id  # type: ignore

        id_ch1 = _concept_id("Rank", "Chapter 1")
        id_ch2 = _concept_id("Rank", "Chapter 2")
        assert id_ch1 != id_ch2

    def test_mixed_case_same_concept_same_id(self):
        """Concept ID is case-insensitive for both name and chapter."""
        from adaptlearn.knowledge_graph import _concept_id  # type: ignore

        id_lower = _concept_id("matrix multiplication", "chapter 1")
        id_upper = _concept_id("Matrix Multiplication", "Chapter 1")
        assert id_lower == id_upper


class TestNormalizeName:
    def test_space_separated_tokens_preserved(self):
        """'Matrix Multiplication' and 'MatrixMultiplication' must NOT normalize identically."""
        from adaptlearn.pipeline import _normalize_name  # type: ignore

        assert _normalize_name("Matrix Multiplication") != _normalize_name("MatrixMultiplication")

    def test_normalize_strips_punctuation(self):
        from adaptlearn.pipeline import _normalize_name  # type: ignore

        assert _normalize_name("Ax=b") == _normalize_name("Ax b")


class TestCourseCreation:
    def test_course_record_created_on_ingest(self, service):
        """Ingesting material must create exactly one Course record."""
        text = (
            "Graph graph graph theory studies vertices edges connectivity. "
            "Trees are connected acyclic graphs with n vertices and n-1 edges. "
            "Spanning spanning spanning trees include all vertices with minimum edges. "
            "Bipartite bipartite graphs can be 2-colored without adjacent same-color vertices. "
            "Eulerian Eulerian paths visit every edge exactly once in a graph."
        )
        service.ingest_material(
            file_name="graph_theory.txt",
            file_bytes=text.encode("utf-8"),
            course_name="Graph Theory",
            template_mode="generic",
        )
        courses = service.list_courses()
        assert len(courses) >= 1
        assert any(c.subject == "Graph Theory" for c in courses)


class TestPassProbabilityFormula:
    def test_no_attempts_returns_baseline(self):
        from adaptlearn.pipeline import _estimate_pass_probability  # type: ignore

        assert _estimate_pass_probability([]) == pytest.approx(0.55)

    def test_all_correct_high_probability(self):
        from adaptlearn.models import Attempt
        from adaptlearn.pipeline import _estimate_pass_probability  # type: ignore
        from datetime import datetime

        attempts = [
            Attempt(
                question_id=f"q-{i}",
                concept_id="c-1",
                user_answer="correct",
                is_correct=True,
                score=1.0,
                feedback="",
                created_at=datetime.now(),
            )
            for i in range(10)
        ]
        prob = _estimate_pass_probability(attempts)
        assert prob > 0.8

    def test_all_wrong_low_probability(self):
        from adaptlearn.models import Attempt
        from adaptlearn.pipeline import _estimate_pass_probability  # type: ignore
        from datetime import datetime

        attempts = [
            Attempt(
                question_id=f"q-{i}",
                concept_id="c-1",
                user_answer="wrong",
                is_correct=False,
                score=0.0,
                feedback="",
                created_at=datetime.now(),
            )
            for i in range(5)
        ]
        prob = _estimate_pass_probability(attempts)
        assert prob < 0.5

    def test_result_clamped_to_valid_range(self):
        from adaptlearn.models import Attempt
        from adaptlearn.pipeline import _estimate_pass_probability  # type: ignore
        from datetime import datetime

        # 30 perfect attempts — should not exceed 0.95 ceiling
        attempts = [
            Attempt(
                question_id=f"q-{i}",
                concept_id="c-1",
                user_answer="perfect",
                is_correct=True,
                score=1.0,
                feedback="",
                created_at=datetime.now(),
            )
            for i in range(30)
        ]
        prob = _estimate_pass_probability(attempts)
        assert 0.25 <= prob <= 0.95


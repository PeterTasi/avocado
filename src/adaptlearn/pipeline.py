from __future__ import annotations

from collections import defaultdict
from datetime import datetime

from .config import Settings
from .database import StudyRepository
from .domain_templates import get_seed_concepts
from .gemini_client import GeminiClient
from .knowledge_graph import build_knowledge_graph
from .models import Attempt, Concept, ConceptEdge, Question, ReviewItem
from .pdf_parser import extract_text
from .quiz_engine import build_questions_for_concepts
from .review_scheduler import build_review_plan
from .vector_store import ConceptVectorStore


class AdaptLearnService:
    def __init__(self, settings: Settings, api_key: str | None = None) -> None:
        self.settings = settings
        key = settings.gemini_api_key if api_key is None else api_key.strip()

        self.repo = StudyRepository(settings.database_path)
        self.repo.initialize()

        self.gemini = GeminiClient(api_key=key, model=settings.gemini_model)
        self.vector_store = ConceptVectorStore(settings.chroma_path)

    @property
    def llm_enabled(self) -> bool:
        return self.gemini.enabled

    def ingest_material(
        self,
        file_name: str,
        file_bytes: bytes,
        course_name: str,
        template_mode: str = "generic",
    ) -> dict[str, object]:
        material_text = extract_text(file_name=file_name, file_bytes=file_bytes)
        text_chars = len(material_text.strip())
        low_text_mode = text_chars < 40
        seed_concepts = get_seed_concepts(course_name=course_name, template_mode=template_mode)
        used_seed_template = bool(seed_concepts)

        if low_text_mode:
            if used_seed_template:
                # If the uploaded file has little selectable text, use the selected template as fallback.
                concepts = list(seed_concepts)
                edges = _build_edges_from_concepts(concepts)
                ingest_mode = "template-fallback"
            else:
                raise ValueError(
                    "這份檔案幾乎沒有可讀文字。"
                    "請先把 PDF 做 OCR（可搜尋文字），或明確選擇課程模板。"
                )
        else:
            concepts, edges = build_knowledge_graph(
                text=material_text,
                course_name=course_name,
                gemini_client=self.gemini,
            )
            if used_seed_template:
                concepts = _merge_concept_sets(concepts, seed_concepts)
                edges = _build_edges_from_concepts(concepts)
            ingest_mode = "text-extraction"

        if not concepts:
            raise ValueError(
                "無法從這份檔案抽取概念。"
                "若是掃描/圖片筆記，請先做 OCR，或改用明確模板。"
            )

        # Replace previous corpus-derived state so a new upload reflects only the current material.
        self.repo.reset_learning_state(include_attempts=True)
        self.repo.upsert_concepts(concepts)
        self.repo.replace_edges(edges)
        self.vector_store.upsert_concepts(concepts, replace_existing=True)

        return {
            "concept_count": len(concepts),
            "edge_count": len(edges),
            "material_chars": text_chars,
            "low_text_mode": low_text_mode,
            "used_seed_template": used_seed_template,
            "template_mode": template_mode,
            "ingest_mode": ingest_mode,
        }

    def generate_diagnostics(self, question_count: int = 9) -> list[Question]:
        concepts = self.repo.list_concepts()
        if not concepts:
            return []

        attempts = self.repo.list_attempts(limit=3000)
        target_count = max(1, min(len(concepts), question_count // 3 or 1))
        target_concepts = self._select_weak_concepts(concepts, attempts, target_count)

        questions = build_questions_for_concepts(
            concepts=target_concepts,
            gemini_client=self.gemini,
            per_concept=3,
        )
        questions = questions[:question_count]

        self.repo.save_questions(questions)
        return questions

    def grade_question(self, question_id: str, user_answer: str) -> dict[str, str | bool | float]:
        question = self.repo.get_question(question_id)
        if not question:
            raise ValueError("Question not found. Generate a new diagnostic set.")

        grading = self.gemini.grade_answer(
            question_text=question.question_text,
            expected_answer=question.answer_text,
            user_answer=user_answer,
        )

        attempt = Attempt(
            question_id=question.id,
            concept_id=question.concept_id,
            user_answer=user_answer,
            is_correct=bool(grading["is_correct"]),
            score=float(grading["score"]),
            feedback=str(grading["feedback"]),
            created_at=datetime.now(),
        )
        self.repo.save_attempt(attempt)

        return {
            "score": float(grading["score"]),
            "is_correct": bool(grading["is_correct"]),
            "feedback": str(grading["feedback"]),
            "expected_answer": question.answer_text,
            "rationale": question.rationale,
        }

    def build_and_save_review_plan(self) -> list[ReviewItem]:
        concepts = self.repo.list_concepts()
        attempts = self.repo.list_attempts(limit=5000)
        review_plan = build_review_plan(concepts=concepts, attempts=attempts)
        self.repo.save_review_plan(review_plan)
        return review_plan

    def list_review_plan(self) -> list[ReviewItem]:
        return self.repo.list_review_plan(limit=200)

    def list_concepts(self) -> list[Concept]:
        return self.repo.list_concepts()

    def get_concept_mastery(self) -> list[dict[str, object]]:
        concepts = self.repo.list_concepts()
        attempts = self.repo.list_attempts(limit=5000)

        scores_by_concept: dict[str, list[float]] = defaultdict(list)
        for attempt in attempts:
            scores_by_concept[attempt.concept_id].append(attempt.score)

        rows: list[dict[str, object]] = []
        for concept in concepts:
            scores = scores_by_concept.get(concept.id, [])
            mastery = sum(scores) / len(scores) if scores else 0.0
            rows.append(
                {
                    "concept_id": concept.id,
                    "name": concept.name,
                    "chapter": concept.chapter,
                    "mastery": round(mastery, 3),
                    "attempts": len(scores),
                    "status": _mastery_band(mastery),
                }
            )

        rows.sort(key=lambda row: (str(row["chapter"]), str(row["name"])))
        return rows

    def get_chapter_mastery(self) -> list[dict[str, object]]:
        concept_rows = self.get_concept_mastery()
        grouped: dict[str, list[dict[str, object]]] = defaultdict(list)
        for row in concept_rows:
            grouped[str(row["chapter"])].append(row)

        chapter_rows: list[dict[str, object]] = []
        for chapter, rows in grouped.items():
            masteries = [float(row["mastery"]) for row in rows]  # type: ignore[arg-type]
            avg_mastery = sum(masteries) / len(masteries) if masteries else 0.0
            attempted_concepts = sum(1 for row in rows if int(row["attempts"]) > 0)  # type: ignore[call-overload,misc]
            chapter_rows.append(
                {
                    "chapter": chapter,
                    "avg_mastery": round(avg_mastery, 3),
                    "concept_count": len(rows),
                    "attempted_concepts": attempted_concepts,
                    "status": _mastery_band(avg_mastery),
                }
            )

        chapter_rows.sort(key=lambda row: str(row["chapter"]))
        return chapter_rows

    def get_tonight_study_dashboard(self, top_n: int = 5) -> dict[str, object]:
        concepts = self.repo.list_concepts()
        attempts = self.repo.list_attempts(limit=5000)

        review_items = self.repo.list_review_plan(limit=200)
        if not review_items:
            review_items = build_review_plan(concepts=concepts, attempts=attempts)

        top_n = max(1, top_n)
        focus_candidates = review_items[:top_n]

        concept_map = {concept.id: concept for concept in concepts}
        focus_items: list[dict[str, object]] = []
        for item in focus_candidates:
            concept = concept_map.get(item.concept_id)
            chapter = concept.chapter if concept else "Unknown"
            gain = min(0.1, 0.015 + (item.priority * 0.05))
            focus_items.append(
                {
                    "concept": item.concept_name,
                    "chapter": chapter,
                    "slot": item.suggested_slot,
                    "priority": round(item.priority, 3),
                    "estimated_gain": round(gain, 3),
                }
            )

        pass_before = _estimate_pass_probability(attempts)
        uplift = min(0.3, sum(float(d["estimated_gain"]) for d in focus_items))  # type: ignore[misc, arg-type]
        pass_after = _clamp(pass_before + uplift, 0.0, 0.98)

        chapters: list[str] = []
        for d in focus_items:
            chapter = str(d["chapter"])
            if chapter not in chapters:
                chapters.append(chapter)

        return {
            "before": pass_before,
            "uplift": uplift,
            "after": pass_after,
            "chapters": chapters,
            "focus_items": focus_items,
        }

    def list_questions(self, limit: int = 100) -> list[Question]:
        return self.repo.list_questions(limit=limit)

    def get_question(self, question_id: str) -> Question | None:
        return self.repo.get_question(question_id)

    def search_related_concepts(self, query: str, n_results: int = 5) -> list[dict]:
        return self.vector_store.query_related(query=query, n_results=n_results)

    def get_graphviz(self) -> str:
        concepts = self.repo.list_concepts()
        edges = self.repo.list_edges()
        if not concepts:
            return "digraph ConceptGraph { empty [label=\"No concepts yet\"]; }"

        lines = ["digraph ConceptGraph {", "rankdir=LR;"]
        for concept in concepts:
            label = _escape_label(f"{concept.name}\\n[{concept.chapter}]")
            lines.append(f'"{concept.id}" [shape=box, label="{label}"];')

        for edge in edges[:400]:
            relation = _escape_label(edge.relation)
            lines.append(f'"{edge.source_id}" -> "{edge.target_id}" [label="{relation}"];')

        lines.append("}")
        return "\n".join(lines)

    def get_metrics(self) -> dict[str, float]:
        metrics = self.repo.get_metrics()
        return {
            "concept_count": metrics["concept_count"],
            "attempt_count": metrics["attempt_count"],
            "accuracy": metrics["avg_score"],
        }

    def _select_weak_concepts(
        self,
        concepts: list[Concept],
        attempts: list[Attempt],
        target_count: int,
    ) -> list[Concept]:
        if not attempts:
            return concepts[:target_count]

        scores_by_concept: dict[str, list[float]] = {concept.id: [] for concept in concepts}
        for attempt in attempts:
            if attempt.concept_id in scores_by_concept:
                scores_by_concept[attempt.concept_id].append(attempt.score)

        def weakness_score(concept: Concept) -> float:
            scores = scores_by_concept.get(concept.id, [])
            if not scores:
                return 1.0
            return 1.0 - (sum(scores) / len(scores))

        ranked = sorted(concepts, key=weakness_score, reverse=True)
        return ranked[:target_count]


def _escape_label(value: str) -> str:
    return value.replace('"', '\\"')


def _normalize_name(value: str) -> str:
    return "".join(ch.lower() for ch in value if ch.isalnum())


def _merge_concept_sets(extracted: list[Concept], seeded: list[Concept]) -> list[Concept]:
    merged = list(extracted)
    used_ids = {concept.id for concept in merged}
    index_by_name = {_normalize_name(concept.name): idx for idx, concept in enumerate(merged)}

    for seed in seeded:
        normalized = _normalize_name(seed.name)
        existing_index = index_by_name.get(normalized)

        if existing_index is None:
            new_id = seed.id if seed.id not in used_ids else f"{seed.id}-seed"
            used_ids.add(new_id)
            merged.append(
                Concept(
                    id=new_id,
                    name=seed.name,
                    chapter=seed.chapter,
                    description=seed.description,
                    prerequisites=list(seed.prerequisites),
                )
            )
            index_by_name[normalized] = len(merged) - 1
            continue

        existing = merged[existing_index]
        merged_prereq = sorted(set(existing.prerequisites + seed.prerequisites))
        merged_chapter = (
            seed.chapter
            if existing.chapter.lower() in {"general", "chapter 1", "chapter 2", "chapter 3"}
            else existing.chapter
        )
        merged_description = (
            seed.description
            if "auto-extracted" in existing.description.lower()
            else existing.description
        )
        merged[existing_index] = Concept(
            id=existing.id,
            name=existing.name,
            chapter=merged_chapter,
            description=merged_description,
            prerequisites=merged_prereq,
        )

    return merged


def _build_edges_from_concepts(concepts: list[Concept]) -> list[ConceptEdge]:
    name_to_id = {_normalize_name(concept.name): concept.id for concept in concepts}
    edges: list[ConceptEdge] = []

    for concept in concepts:
        for prereq_name in concept.prerequisites:
            source_id = name_to_id.get(_normalize_name(prereq_name))
            if source_id and source_id != concept.id:
                edges.append(
                    ConceptEdge(
                        source_id=source_id,
                        target_id=concept.id,
                        relation="prerequisite",
                    )
                )

    chapter_groups: dict[str, list[Concept]] = defaultdict(list)
    for concept in concepts:
        chapter_groups[concept.chapter].append(concept)

    for chapter_concepts in chapter_groups.values():
        for index in range(len(chapter_concepts) - 1):
            edges.append(
                ConceptEdge(
                    source_id=chapter_concepts[index].id,
                    target_id=chapter_concepts[index + 1].id,
                    relation="next",
                )
            )

    deduped: list[ConceptEdge] = []
    seen: set[tuple[str, str, str]] = set()
    for edge in edges:
        key = (edge.source_id, edge.target_id, edge.relation)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(edge)
    return deduped


def _estimate_pass_probability(attempts: list[Attempt]) -> float:
    if not attempts:
        return 0.55

    avg_score = sum(item.score for item in attempts) / len(attempts)
    accuracy = sum(1.0 for item in attempts if item.is_correct) / len(attempts)
    experience_bonus = min(len(attempts) / 30.0, 1.0)

    probability = 0.32 + (0.46 * avg_score) + (0.16 * accuracy) + (0.06 * experience_bonus)
    return _clamp(probability, 0.25, 0.95)


def _mastery_band(mastery: float) -> str:
    if mastery >= 0.75:
        return "green"
    if mastery >= 0.5:
        return "yellow"
    return "red"


def _clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(value, upper))

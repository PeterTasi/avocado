from __future__ import annotations

import hashlib
import logging
import re
from collections import defaultdict
from datetime import datetime, timezone
from typing import Callable

from .chandra_client import ChandraClient
from .class_heatmap import compute_class_heatmap, get_weak_concepts
from .config import Settings
from .cross_course_linker import find_cross_course_links
from .database import StudyRepository
from .domain_templates import get_seed_concepts
from .gemini_client import GeminiClient
from .knowledge_graph import build_knowledge_graph
from .models import Attempt, Concept, ConceptDetail, ConceptEdge, Course, CrossCourseEdge, Question, ReviewItem
from .ollama_client import OllamaClient
from .pdf_parser import extract_material_text
from .quiz_engine import build_questions_for_concepts
from .review_scheduler import build_review_plan
from .vector_store import ConceptVectorStore

logger = logging.getLogger("adaptlearn.pipeline")


class AdaptLearnService:
    def __init__(self, settings: Settings, api_key: str | None = None) -> None:
        self.settings = settings
        key = settings.gemini_api_key if api_key is None else api_key.strip()

        self.repo = StudyRepository(settings.database_url)
        self.repo.initialize()

        self.gemini = GeminiClient(api_key=key, model=settings.gemini_model)
        self.chandra = ChandraClient(
            method=settings.chandra_method,
            vllm_url=settings.chandra_vllm_url,
        )
        # Local Ollama vision OCR (opt-in via OLLAMA_OCR_MODEL); primary OCR path when set.
        self.ollama = OllamaClient(
            model=settings.ollama_ocr_model,
            base_url=settings.ollama_url,
        )
        self.vector_store = ConceptVectorStore(settings.chroma_path)
        # Use Gemini for embeddings when a key is present so vector indexing doesn't fall
        # back to ChromaDB's heavy local ONNX model (the stage-3 bottleneck on Render free).
        self.vector_store.set_embedder(self.gemini)

    def set_api_key(self, api_key: str) -> None:
        self.gemini.set_api_key(api_key)
        logger.info("Gemini API key updated (service not rebuilt)")

    def close(self) -> None:
        """Release all resources (DB connections, vector store singletons)."""
        self.repo.close()
        self.vector_store.close()
        logger.info("AdaptLearnService resources released")

    @property
    def llm_enabled(self) -> bool:
        return self.gemini.enabled

    def ingest_material(
        self,
        file_name: str,
        file_bytes: bytes,
        course_name: str,
        template_mode: str = "generic",
        progress: Callable[[str], None] | None = None,
    ) -> dict[str, object]:
        def _stage(label: str) -> None:
            if progress is not None:
                progress(label)

        _stage("解析教材內容")
        extracted_material = extract_material_text(
            file_name=file_name,
            file_bytes=file_bytes,
            gemini_client=self.gemini,
            chandra_client=self.chandra,
            ollama_client=self.ollama,
            ocr_context=course_name,
            max_ocr_pages=self.settings.max_ocr_pages,
        )
        material_text = extracted_material.text
        text_chars = len(material_text.strip())
        low_text_mode = text_chars < 40
        seed_concepts = get_seed_concepts(course_name=course_name, template_mode=template_mode)
        used_seed_template = bool(seed_concepts)

        # Reset LLM error state so we can detect failures during this ingest.
        self.gemini.last_error = ""

        # P1: compute course_id BEFORE build_knowledge_graph so it can be passed in.
        course_id = hashlib.sha256(f"{course_name}:{file_name}".encode()).hexdigest()[:12]

        ocr_failed = False
        ocr_message = ""
        if low_text_mode:
            if used_seed_template:
                concepts = list(seed_concepts)
                # Assign course_id to seed concepts and recompute their IDs with course scope.
                for concept in concepts:
                    concept.course_id = course_id
                edges = _build_edges_from_concepts(concepts)
                ingest_mode = "template-fallback"
                # OCR produced nothing usable, so these are generic template concepts —
                # NOT the student's actual material. Flag it loudly (Bug 1).
                ocr_failed = True
                ocr_message = (
                    "未能轉寫手寫／掃描內容，目前顯示的是課程模板概念，"
                    "並非你上傳教材的實際內容。請改用更清晰的檔案、提供可用的 Gemini API 金鑰，"
                    "或先做外部 OCR 後再上傳。"
                )
                logger.warning(
                    "OCR yielded <%d chars; falling back to seed template (course=%s, source=%s)",
                    40, course_name, extracted_material.source_type,
                )
            else:
                raise ValueError(
                    "這份檔案幾乎沒有可讀文字。"
                    "若是手寫/掃描筆記，請先提供 Gemini API 金鑰讓系統轉寫，"
                    "或先把 PDF 做 OCR（可搜尋文字），或明確選擇課程模板。"
                )
        else:
            _stage("建立知識圖譜")
            concepts, edges = build_knowledge_graph(
                text=material_text,
                course_name=course_name,
                gemini_client=self.gemini,
                course_id=course_id,
            )
            if used_seed_template:
                concepts = _merge_concept_sets(concepts, seed_concepts)
                edges = _build_edges_from_concepts(concepts)
            ingest_mode = "ocr-transcription" if extracted_material.ocr_used else "text-extraction"

        # Capture whether Gemini encountered errors during this ingest.
        llm_degraded = self.gemini.enabled and bool(self.gemini.last_error)
        if llm_degraded:
            logger.warning("LLM degraded during ingest (last_error=%s)", self.gemini.last_error)

        if not concepts:
            raise ValueError(
                "無法從這份檔案抽取概念。"
                "若是掃描/圖片筆記，請先做 OCR，或提供 Gemini API 金鑰後再試，"
                "或改用明確模板。"
            )

        # Create course record (P2: use timezone-aware datetime)
        course = Course(
            id=course_id,
            user_id="default",
            subject=course_name,
            filename=file_name,
            uploaded_at=datetime.now(timezone.utc),
        )
        self.repo.save_course(course)

        # Assign course_id to all concepts
        for concept in concepts:
            concept.course_id = course_id

        _stage("儲存概念與章節")
        # P1: course-scoped reset (keeps attempts from other courses + all history)
        self.repo.set_active_course(course_id)
        self.repo.reset_course_state(course_id)
        self.repo.upsert_concepts(concepts)
        self.repo.replace_edges(edges)

        _stage("建立向量索引")
        self.vector_store.upsert_concepts(concepts, replace_existing=False, course_id=course_id)

        # Module D: discover cross-course links
        _stage("尋找跨課程關聯")
        cross_edges = find_cross_course_links(
            new_concepts=concepts,
            course_id=course_id,
            vector_store=self.vector_store,
            repo=self.repo,
        )
        logger.info("Ingested course=%s concepts=%d edges=%d cross=%d",
                     course_id, len(concepts), len(edges), len(cross_edges))

        return {
            "course_id": course_id,
            "concept_count": len(concepts),
            "edge_count": len(edges),
            "cross_course_links": len(cross_edges),
            "material_chars": text_chars,
            "low_text_mode": low_text_mode,
            "ocr_used": extracted_material.ocr_used,
            "source_type": extracted_material.source_type,
            "used_seed_template": used_seed_template,
            "template_mode": template_mode,
            "ingest_mode": ingest_mode,
            "llm_degraded": llm_degraded,
            "ocr_failed": ocr_failed,
            "ocr_message": ocr_message,
            "llm_last_error": self.gemini.last_error,
        }

    def generate_diagnostics(self, question_count: int = 9, language: str = "zh") -> list[Question]:
        # P1: scope to active course
        active_course_id = self.repo.get_active_course_id()
        concepts = self.repo.list_concepts(course_id=active_course_id)
        if not concepts:
            return []

        summary = self.repo.concept_score_summary(course_id=active_course_id)
        target_count = max(1, min(len(concepts), question_count // 3 or 1))
        target_concepts = self._select_weak_concepts(concepts, summary, target_count)

        questions = build_questions_for_concepts(
            concepts=target_concepts,
            gemini_client=self.gemini,
            per_concept=3,
            language=language,
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
            created_at=datetime.now(timezone.utc),
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
        # P1: scope to active course
        active_course_id = self.repo.get_active_course_id()
        concepts = self.repo.list_concepts(course_id=active_course_id)
        attempts = self.repo.list_attempts(limit=5000)
        review_plan = build_review_plan(concepts=concepts, attempts=attempts)
        self.repo.save_review_plan(review_plan)
        return review_plan

    def list_review_plan(self) -> list[ReviewItem]:
        return self.repo.list_review_plan(limit=200)

    def list_concepts(self) -> list[Concept]:
        # P1: scope to active course
        active_course_id = self.repo.get_active_course_id()
        return self.repo.list_concepts(course_id=active_course_id)

    def get_concept_mastery(self) -> list[dict[str, object]]:
        # P1: scope to active course
        active_course_id = self.repo.get_active_course_id()
        concepts = self.repo.list_concepts(course_id=active_course_id)
        summary = self.repo.concept_score_summary(course_id=active_course_id)

        rows: list[dict[str, object]] = []
        for concept in concepts:
            entry = summary.get(concept.id, {})
            mastery = entry.get("avg_score", 0.0)
            rows.append(
                {
                    "concept_id": concept.id,
                    "name": concept.name,
                    "chapter": concept.chapter,
                    "mastery": round(mastery, 3),
                    "attempts": entry.get("count", 0),
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
        # P1: scope to active course
        active_course_id = self.repo.get_active_course_id()
        concepts = self.repo.list_concepts(course_id=active_course_id)
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

        has_data = bool(attempts)

        pass_before = _estimate_pass_probability(attempts) if has_data else 0.0
        uplift = min(0.3, sum(float(d["estimated_gain"]) for d in focus_items)) if has_data else 0.0  # type: ignore[misc, arg-type]
        pass_after = _clamp(pass_before + uplift, 0.0, 0.98) if has_data else 0.0

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
            "has_data": has_data,
        }

    def list_questions(self, limit: int = 100) -> list[Question]:
        return self.repo.list_questions(limit=limit)

    def get_question(self, question_id: str) -> Question | None:
        return self.repo.get_question(question_id)

    def search_related_concepts(self, query: str, n_results: int = 5) -> list[dict]:
        return self.vector_store.query_related(query=query, n_results=n_results)

    def get_graphviz(self) -> str:
        # P1: scope to active course
        active_course_id = self.repo.get_active_course_id()
        concepts = self.repo.list_concepts(course_id=active_course_id)
        edges = self.repo.list_edges(course_id=active_course_id)
        cross_edges = self.repo.list_cross_course_edges()
        if not concepts:
            return "digraph ConceptGraph { empty [label=\"No concepts yet\"]; }"

        lines = ["digraph ConceptGraph {", "rankdir=LR;"]
        for concept in concepts:
            label = _escape_label(f"{concept.name}\\n[{concept.chapter}]")
            lines.append(f'"{concept.id}" [shape=box, label="{label}"];')

        for edge in edges[:400]:
            relation = _escape_label(edge.relation)
            lines.append(f'"{edge.source_id}" -> "{edge.target_id}" [label="{relation}"];')

        # Cross-course edges rendered as dashed lines
        for ce in cross_edges[:100]:
            label = _escape_label(f"{ce.link_type} ({ce.similarity:.2f})")
            lines.append(
                f'"{ce.from_concept_id}" -> "{ce.to_concept_id}" '
                f'[label="{label}", style=dashed, color=blue];'
            )

        lines.append("}")
        return "\n".join(lines)

    def get_class_heatmap(self, course_id: str) -> list[dict]:
        """Return class-level understanding heatmap for a course."""
        stats = compute_class_heatmap(course_id=course_id, repo=self.repo)
        concept_map = {c.id: c.name for c in self.repo.list_concepts()}
        return [
            {
                "concept_id": s.concept_id,
                "concept_name": concept_map.get(s.concept_id, s.concept_id),
                "error_rate": s.error_rate,
                "sample_count": s.sample_count,
                "status": "red" if s.error_rate >= 0.6 else ("yellow" if s.error_rate >= 0.3 else "green"),
            }
            for s in stats
        ]

    def get_class_weak_concepts(self, course_id: str, top_n: int = 3) -> list[dict]:
        """Return teacher recommendations for weakest concepts."""
        return get_weak_concepts(
            course_id=course_id,
            repo=self.repo,
            top_n=top_n,
            uplift_cap=self.settings.heatmap_uplift_cap,
            uplift_ratio=self.settings.heatmap_uplift_ratio,
        )

    def list_courses(self) -> list[Course]:
        return self.repo.list_courses()

    def clear_course(self, course_id: str) -> None:
        """Permanently remove a course and all data derived from it (Bug 5 方案 C)."""
        if not self.repo.get_course(course_id):
            raise ValueError(f"找不到課程：{course_id}")
        self.repo.reset_course_state(course_id)
        self.repo.delete_course(course_id)
        self.vector_store.delete_course(course_id)

    def list_cross_course_edges(self) -> list[CrossCourseEdge]:
        return self.repo.list_cross_course_edges()

    def get_metrics(self) -> dict[str, float]:
        active_course_id = self.repo.get_active_course_id()
        metrics = self.repo.get_metrics(course_id=active_course_id)
        return {
            "concept_count": metrics["concept_count"],
            "attempt_count": metrics["attempt_count"],
            "accuracy": metrics["avg_score"],
        }

    # P2: Progress trend API
    def get_concept_progress(self, days: int = 30) -> list[dict]:
        active_course_id = self.repo.get_active_course_id()
        if not active_course_id:
            return []

        concept_data = self.repo.concept_progress(course_id=active_course_id, days=days)

        concepts = self.repo.list_concepts(course_id=active_course_id)
        name_map = {c.id: c.name for c in concepts}

        result = []
        for item in concept_data:
            daily = item["daily"]
            if len(daily) < 2:
                trend = "plateaued"
            else:
                mid = len(daily) // 2
                first_half_avg = sum(d["avg_score"] for d in daily[:mid]) / mid
                second_half_avg = sum(d["avg_score"] for d in daily[mid:]) / (len(daily) - mid)
                diff = second_half_avg - first_half_avg
                if diff > 0.05:
                    trend = "improving"
                elif diff < -0.05:
                    trend = "declining"
                else:
                    trend = "plateaued"

            result.append({
                "concept_id": item["concept_id"],
                "concept_name": name_map.get(item["concept_id"], item["concept_id"]),
                "daily": daily,
                "trend": trend,
            })

        return result

    def get_or_generate_concept_detail(self, concept_id: str, language: str) -> ConceptDetail:
        """Lazy：先查快取，未命中才呼叫 Gemini 生成並存。"""
        if language not in ("zh", "en"):
            language = "zh"

        cached = self.repo.get_concept_detail(concept_id, language)
        if cached is not None:
            return cached

        concept = next(
            (c for c in self.repo.list_concepts() if c.id == concept_id), None
        )
        if concept is None:
            raise ValueError(f"找不到概念：{concept_id}")

        raw = self.gemini.generate_concept_detail(
            name=concept.name,
            chapter=concept.chapter,
            description=concept.description,
            language=language,
        )
        degraded = bool(raw.get("degraded", False))
        detail = ConceptDetail(
            concept_id=concept_id,
            language=language,
            definition=raw["definition"],
            key_points=raw["key_points"],
            example=raw["example"],
            common_mistakes=raw["common_mistakes"],
            has_formula=raw["has_formula"],
            degraded=degraded,
        )
        # 只快取成功生成的結果；降級（如額度用盡）不存，下次重試
        if not degraded:
            self.repo.save_concept_detail(detail)
        return detail

    def _select_weak_concepts(
        self,
        concepts: list[Concept],
        summary: dict[str, dict],
        target_count: int,
    ) -> list[Concept]:
        if not summary:
            return concepts[:target_count]

        def weakness_score(concept: Concept) -> float:
            entry = summary.get(concept.id)
            if not entry:
                return 1.0
            return 1.0 - entry["avg_score"]

        ranked = sorted(concepts, key=weakness_score, reverse=True)
        return ranked[:target_count]


def _escape_label(value: str) -> str:
    return value.replace('"', '\\"')


def _normalize_name(value: str) -> str:
    """Normalise a concept name for dedup-matching (preserves token separation)."""
    tokens = re.findall(r"[a-z0-9]+", value.lower())
    if tokens:
        return " ".join(tokens)
    # CJK fallback
    return "".join(re.findall(r"[一-鿿]+", value))


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
    """Estimate exam-pass probability from past attempt history.

    Formula: P = 0.32 + 0.46·avg_score + 0.16·accuracy + 0.06·experience_bonus

    Coefficients are **empirical placeholders** and have not been validated
    against real cohort data.  They should be recalibrated with logistic
    regression once longitudinal data is available.

    - 0.32  baseline prior for a student with no history
    - 0.46  average score weight — strongest recent-performance signal
    - 0.16  binary accuracy weight — rewards consistency over raw score
    - 0.06  experience bonus — log-saturates at 30 attempts to prevent
            over-confidence from sheer volume

    Returns: float in [0.25, 0.95].
    """
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

from __future__ import annotations

import re
from collections import Counter

from .models import Concept, ConceptEdge

STOPWORDS = {
    "the",
    "and",
    "for",
    "with",
    "that",
    "from",
    "this",
    "have",
    "into",
    "your",
    "chapter",
    "section",
    "example",
    "using",
    "student",
    "learning",
    "course",
    "topic",
    "topics",
    "core",
    "intro",
    "introduction",
    "overview",
    "solve",
    "solves",
    "solving",
    "explain",
    "explains",
    "including",
    "includes",
    "using",
    "use",
}

NOISE_TERMS = {
    "week",
    "weeks",
    "wk",
    "lecture",
    "lectures",
    "syllabus",
    "announcement",
    "announcements",
    "attendance",
    "homework",
    "assignment",
    "assignments",
    "deadline",
    "deadlines",
    "midterm",
    "final",
    "office",
    "hour",
    "hours",
    "schedule",
    "grading",
    "quiz",
    "quizzes",
    "week1",
    "week2",
    "week3",
    "week4",
    "week5",
    "week6",
    "week7",
    "week8",
    "week9",
    "week10",
    "week11",
    "week12",
    "week13",
    "week14",
    "week15",
    "week16",
    "week17",
    "week18",
    "第1週",
    "第2週",
    "第3週",
    "第4週",
    "第5週",
    "第6週",
    "第7週",
    "第8週",
    "第9週",
    "第10週",
    "第11週",
    "第12週",
    "第13週",
    "第14週",
    "第15週",
    "第16週",
    "第17週",
    "第18週",
    "週次",
    "課程介紹",
    "公告",
    "作業",
    "考試",
    "評分",
    "進度",
}

_WEEK_PATTERN = re.compile(r"(?i)^(?:week|wk)\s*\d+\b|第\s*\d+\s*週|\bweek\s*\d+\b")
_LOGISTICS_HINT_PATTERN = re.compile(
    r"(?i)\b(?:syllabus|announcement|attendance|homework|assignment|deadline|office\s*hours?|grading|exam|quiz)\b"
    r"|課程介紹|公告|作業|考試|評分|繳交|週次"
)
_CJK_PHRASE_PATTERN = re.compile(r"[\u4e00-\u9fff]{2,10}")
_SHORT_CANONICAL_TERMS = {"svd", "bfs", "dfs", "pca", "fft", "rref", "pdf", "cdf"}


def build_knowledge_graph(
    text: str,
    course_name: str,
    gemini_client,
    max_concepts: int = 24,
) -> tuple[list[Concept], list[ConceptEdge]]:
    cleaned_text = _sanitize_material_text(text)
    records = gemini_client.extract_concepts(
        text=cleaned_text,
        course_name=course_name,
        max_concepts=max_concepts,
    )
    concepts = _records_to_concepts(records, max_concepts=max_concepts)
    if not concepts:
        concepts = _heuristic_extract_concepts(text=cleaned_text, max_concepts=max_concepts)

    edges = _build_edges(concepts)
    return concepts, edges


def _records_to_concepts(records: list[dict], max_concepts: int) -> list[Concept]:
    concepts: list[Concept] = []
    used_ids: set[str] = set()
    used_names: set[str] = set()

    for index, record in enumerate(records):
        if len(concepts) >= max_concepts:
            break

        raw_name = str(record.get("name", "")).strip()
        if not _is_valid_concept_name(raw_name):
            continue

        name = _normalize_phrase(raw_name)
        normalized_name = _normalize_name(name)
        if not normalized_name or normalized_name in used_names:
            continue

        used_names.add(normalized_name)

        chapter = _normalize_chapter(str(record.get("chapter", "General")).strip())
        description = str(record.get("description", "")).strip() or f"Core idea in {chapter}."
        if _looks_like_logistics(description):
            description = f"Core idea in {chapter}."

        raw_prereq = record.get("prerequisites", [])
        prerequisites = _clean_prerequisites(
            raw_prereq=raw_prereq,
            concept_name=name,
            used_names=used_names,
        )

        base_id = _slugify(name)
        if not base_id:
            base_id = f"concept-{len(concepts) + 1}"

        concept_id = _unique_id(base_id, used_ids)
        concepts.append(
            Concept(
                id=concept_id,
                name=name,
                chapter=chapter,
                description=description,
                prerequisites=prerequisites,
            )
        )

    return concepts


def _heuristic_extract_concepts(text: str, max_concepts: int) -> list[Concept]:
    phrases = _extract_phrase_candidates(text)
    counts = Counter(phrases)

    ranked_terms = sorted(
        counts.keys(),
        key=lambda term: (counts[term], _phrase_score(term), len(term)),
        reverse=True,
    )

    top_terms = ranked_terms[:max_concepts]

    if not top_terms:
        top_terms = [f"Concept {i + 1}" for i in range(min(max_concepts, 8))]

    concepts: list[Concept] = []
    used_ids: set[str] = set()

    for index, term in enumerate(top_terms):
        display_term = _format_concept_name(term)
        chapter = f"Chapter {(index // 6) + 1}"
        base_id = _slugify(display_term) or f"concept-{index + 1}"
        concept_id = _unique_id(base_id, used_ids)
        concepts.append(
            Concept(
                id=concept_id,
                name=display_term,
                chapter=chapter,
                description=f"Auto-extracted key concept: {display_term}.",
                prerequisites=[],
            )
        )

    return concepts


def _build_edges(concepts: list[Concept]) -> list[ConceptEdge]:
    if not concepts:
        return []

    name_to_id = {_normalize_name(concept.name): concept.id for concept in concepts}
    edges: list[ConceptEdge] = []

    for concept in concepts:
        for prereq in concept.prerequisites:
            source_id = name_to_id.get(_normalize_name(prereq))
            if source_id and source_id != concept.id:
                edges.append(ConceptEdge(source_id=source_id, target_id=concept.id, relation="prerequisite"))

    # If prerequisites are missing, infer only a small set of conservative progression links.
    if not edges:
        edges.extend(_infer_progression_edges(concepts))

    return _dedupe_edges(edges)


def _infer_progression_edges(concepts: list[Concept]) -> list[ConceptEdge]:
    chapter_first: dict[str, str] = {}
    chapter_order: list[str] = []
    for concept in concepts:
        chapter = concept.chapter.strip() or "Core Concepts"
        if chapter not in chapter_first:
            chapter_first[chapter] = concept.id
            chapter_order.append(chapter)

    edges: list[ConceptEdge] = []
    for index in range(len(chapter_order) - 1):
        source = chapter_first[chapter_order[index]]
        target = chapter_first[chapter_order[index + 1]]
        if source != target:
            edges.append(ConceptEdge(source_id=source, target_id=target, relation="progression"))

    return edges


def _dedupe_edges(edges: list[ConceptEdge]) -> list[ConceptEdge]:
    deduped: list[ConceptEdge] = []
    seen: set[tuple[str, str, str]] = set()
    for edge in edges:
        key = (edge.source_id, edge.target_id, edge.relation)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(edge)
    return deduped


def _clean_prerequisites(raw_prereq: object, concept_name: str, used_names: set[str]) -> list[str]:
    if not isinstance(raw_prereq, list):
        return []

    concept_normalized = _normalize_name(concept_name)
    cleaned: list[str] = []
    seen: set[str] = set()

    for item in raw_prereq:
        name = _normalize_phrase(str(item).strip())
        normalized = _normalize_name(name)
        if not normalized:
            continue
        if normalized == concept_normalized:
            continue
        if not _is_valid_concept_name(name):
            continue
        if normalized in seen:
            continue
        # Keep only concepts that likely exist in current extraction set.
        if used_names and normalized not in used_names:
            continue
        seen.add(normalized)
        cleaned.append(name)

    return cleaned


def _extract_phrase_candidates(text: str) -> list[str]:
    candidates: list[str] = []

    for sentence in re.split(r"[\n\.!?;:]+", text):
        english_tokens = re.findall(r"[A-Za-z][A-Za-z0-9+_-]{1,}", sentence.lower())
        filtered_tokens = [token for token in english_tokens if _is_candidate_token(token)]

        for token in filtered_tokens:
            candidates.append(token)

        for idx in range(len(filtered_tokens) - 1):
            pair = f"{filtered_tokens[idx]} {filtered_tokens[idx + 1]}"
            if _is_valid_concept_name(pair):
                candidates.append(pair)

    for match in _CJK_PHRASE_PATTERN.findall(text):
        phrase = _normalize_phrase(match)
        if _is_valid_concept_name(phrase):
            candidates.append(phrase)

    return candidates


def _phrase_score(phrase: str) -> float:
    words = len(phrase.split()) if " " in phrase else 1
    base = min(len(phrase), 30) / 30
    bonus = 0.35 if words >= 2 else 0.0
    return base + bonus


def _format_concept_name(value: str) -> str:
    if not re.search(r"[A-Za-z]", value):
        return value

    parts = value.split()
    formatted: list[str] = []
    for part in parts:
        if part in _SHORT_CANONICAL_TERMS:
            formatted.append(part.upper())
        else:
            formatted.append(part.capitalize())
    return " ".join(formatted)


def _normalize_phrase(value: str) -> str:
    return " ".join(value.replace("\t", " ").split()).strip("-_:;,. ")


def _normalize_chapter(value: str) -> str:
    cleaned = _normalize_phrase(value)
    if not cleaned:
        return "Core Concepts"
    if _WEEK_PATTERN.search(cleaned) or _looks_like_logistics(cleaned):
        return "Core Concepts"
    return cleaned


def _is_valid_concept_name(name: str) -> bool:
    cleaned = _normalize_phrase(name)
    if len(cleaned) < 2:
        return False

    lowered = cleaned.lower()
    compact = lowered.replace(" ", "")

    if _WEEK_PATTERN.search(lowered):
        return False
    if _looks_like_logistics(cleaned):
        return False
    if compact.isdigit():
        return False
    if lowered in STOPWORDS or lowered in NOISE_TERMS:
        return False

    english_tokens = re.findall(r"[A-Za-z0-9+_-]+", lowered)
    if english_tokens:
        if all(token in STOPWORDS or token in NOISE_TERMS for token in english_tokens):
            return False
        if len(english_tokens) == 1:
            token = english_tokens[0]
            if len(token) < 4 and token not in _SHORT_CANONICAL_TERMS:
                return False

    return True


def _is_candidate_token(token: str) -> bool:
    if token in STOPWORDS or token in NOISE_TERMS:
        return False
    if _WEEK_PATTERN.search(token):
        return False
    if token.isdigit():
        return False
    if len(token) < 3 and token not in _SHORT_CANONICAL_TERMS:
        return False
    return True


def _looks_like_logistics(text: str) -> bool:
    lowered = text.lower()
    if _LOGISTICS_HINT_PATTERN.search(text):
        return True
    if _WEEK_PATTERN.search(lowered):
        return True
    return False


def _sanitize_material_text(text: str) -> str:
    cleaned_lines: list[str] = []
    for raw_line in text.splitlines():
        line = " ".join(raw_line.split()).strip()
        if not line:
            continue

        lower_line = line.lower()
        is_week_line = bool(_WEEK_PATTERN.search(lower_line))
        has_logistics_hint = bool(_LOGISTICS_HINT_PATTERN.search(line))

        if is_week_line and (has_logistics_hint or len(line) <= 140):
            continue
        if has_logistics_hint and len(line) <= 90:
            continue

        cleaned_lines.append(line)

    cleaned_text = "\n".join(cleaned_lines).strip()
    return cleaned_text or text


def _normalize_name(value: str) -> str:
    alnum_tokens = re.findall(r"[a-z0-9]+", value.lower())
    if alnum_tokens:
        return " ".join(alnum_tokens)
    cjk_tokens = re.findall(r"[\u4e00-\u9fff]+", value)
    return "".join(cjk_tokens)

def _slugify(value: str) -> str:
    value = value.lower().strip()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    value = value.strip("-")
    return value


def _unique_id(base: str, used_ids: set[str]) -> str:
    if base not in used_ids:
        used_ids.add(base)
        return base

    index = 2
    while True:
        candidate = f"{base}-{index}"
        if candidate not in used_ids:
            used_ids.add(candidate)
            return candidate
        index += 1

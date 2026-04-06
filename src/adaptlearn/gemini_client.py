from __future__ import annotations

import json
import logging
import re
from typing import Any

try:
    from google import genai
    from google.api_core import exceptions as google_exceptions
except Exception:  # pragma: no cover
    genai = None  # type: ignore[assignment]
    google_exceptions = None  # type: ignore[assignment]

logger = logging.getLogger("adaptlearn.gemini")

# Specific exceptions we expect from the Gemini API
_API_ERRORS: tuple[type[Exception], ...] = ()
if google_exceptions is not None:
    _API_ERRORS = (
        google_exceptions.GoogleAPIError,
        google_exceptions.RetryError,
        TimeoutError,
        ConnectionError,
    )


class GeminiClient:
    def __init__(self, api_key: str, model: str) -> None:
        self.api_key = api_key.strip()
        self.model_name = model.strip() or "gemini-flash-latest"
        self._model_candidates = _build_model_candidates(self.model_name)
        self.last_error = ""
        self.enabled = bool(self.api_key) and genai is not None
        self._client = None

        if self.enabled:
            self._client = genai.Client(api_key=self.api_key)

    def _generate_content(self, prompt: str) -> str:
        if not self.enabled or not self._client:
            return ""

        last_error: Exception | None = None
        for candidate_model in self._model_candidates:
            try:
                response = self._client.models.generate_content(
                    model=candidate_model,
                    contents=prompt,
                )
            except _API_ERRORS as exc:
                logger.warning("Gemini API error (model=%s): %s", candidate_model, exc)
                last_error = exc
                continue
            except Exception as exc:
                # Unexpected error — log and re-raise so bugs aren't silently swallowed
                logger.error("Unexpected error calling Gemini (model=%s): %s", candidate_model, exc)
                raise

            self.model_name = candidate_model
            self.last_error = ""
            logger.debug("Gemini response OK (model=%s, len=%d)", candidate_model, len(_safe_text(response)))
            return _safe_text(response)

        self.last_error = str(last_error) if last_error else "Gemini returned no response."
        logger.warning("All Gemini model candidates failed: %s", self.last_error)
        return ""

    def extract_concepts(
        self,
        text: str,
        course_name: str,
        max_concepts: int = 24,
    ) -> list[dict[str, Any]]:
        if not self.enabled or not self._client:
            return []

        excerpt = text[:18000]
        prompt = f"""
You are an expert course analyst.
From the material below, extract at most {max_concepts} core concepts.

    Rules:
    - Keep only substantive domain concepts, methods, theorems, and technical definitions.
    - Ignore logistics or teaching admin content: week schedule, lecture plan, announcements, homework, grading rules, exam dates.
    - Do NOT output concepts like "Week 1", "Lecture 3", "Homework", "Announcement", "進度", "作業", "考試", "公告", "週次".
    - Prefer concept names as canonical noun phrases (typically 2-5 words). Single-word concepts are allowed only if technically standard (e.g., Rank, Nullity).
    - "chapter" should be a real topic/chapter label, not week number.
    - "prerequisites" should include only genuine conceptual dependencies that are likely also in the extracted list.

Course: {course_name}

Return ONLY valid JSON array with this schema:
[
  {{
    "name": "concept name",
    "chapter": "chapter or section",
    "description": "one-sentence explanation",
    "prerequisites": ["concept a", "concept b"]
  }}
]

Material:
{excerpt}
""".strip()

        payload = _parse_json_payload(self._generate_content(prompt))
        if not isinstance(payload, list):
            return []

        cleaned: list[dict[str, Any]] = []
        for item in payload:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name", "")).strip()
            if not name:
                continue
            chapter = str(item.get("chapter", "General")).strip() or "General"
            description = str(item.get("description", "")).strip() or f"Core idea of {name}."
            raw_prereq = item.get("prerequisites", [])
            prerequisites = [str(x).strip() for x in raw_prereq if str(x).strip()] if isinstance(raw_prereq, list) else []

            cleaned.append(
                {
                    "name": name,
                    "chapter": chapter,
                    "description": description,
                    "prerequisites": prerequisites,
                }
            )
        return cleaned

    def generate_questions(
        self,
        concepts: list[dict[str, str]],
        per_concept: int = 3,
    ) -> list[dict[str, str]]:
        if not self.enabled or not self._client or not concepts:
            return []

        concept_json = json.dumps(concepts, ensure_ascii=False)
        prompt = f"""
You are an adaptive tutor.
Generate {per_concept} diagnostic questions per concept across difficulty levels.

Return ONLY valid JSON array with schema:
[
  {{
    "concept": "concept name",
    "difficulty": "basic|intermediate|advanced",
    "question": "question text",
    "answer": "reference answer",
    "rationale": "how to solve and why"
  }}
]

Concepts:
{concept_json}
""".strip()

        payload = _parse_json_payload(self._generate_content(prompt))
        if not isinstance(payload, list):
            return []

        cleaned: list[dict[str, str]] = []
        for item in payload:
            if not isinstance(item, dict):
                continue
            concept = str(item.get("concept", "")).strip()
            difficulty = str(item.get("difficulty", "basic")).strip().lower() or "basic"
            question = str(item.get("question", "")).strip()
            answer = str(item.get("answer", "")).strip()
            rationale = str(item.get("rationale", "")).strip() or "Use core definition and assumptions step by step."

            if concept and question and answer:
                cleaned.append(
                    {
                        "concept": concept,
                        "difficulty": difficulty,
                        "question": question,
                        "answer": answer,
                        "rationale": rationale,
                    }
                )
        return cleaned

    def grade_answer(
        self,
        question_text: str,
        expected_answer: str,
        user_answer: str,
    ) -> dict[str, Any]:
        if not user_answer.strip():
            return {
                "score": 0.0,
                "is_correct": False,
                "feedback": "Answer is empty. Provide your reasoning and final result.",
            }

        if not self.enabled or not self._client:
            return _heuristic_grade(expected_answer, user_answer)

        prompt = f"""
You are grading a student's answer.

Question:
{question_text}

Reference answer:
{expected_answer}

Student answer:
{user_answer}

Return ONLY valid JSON object:
{{
  "score": 0.0 to 1.0,
  "is_correct": true or false,
  "feedback": "short actionable feedback"
}}
""".strip()

        payload = _parse_json_payload(self._generate_content(prompt))
        if not isinstance(payload, dict):
            return _heuristic_grade(expected_answer, user_answer)

        try:
            score = float(payload.get("score", 0.0))
        except (TypeError, ValueError):
            score = 0.0
        score = min(max(score, 0.0), 1.0)

        is_correct = bool(payload.get("is_correct", score >= 0.6))
        feedback = str(payload.get("feedback", "Review key definitions and retry.")).strip() or "Review key definitions and retry."
        return {"score": score, "is_correct": is_correct, "feedback": feedback}


def _heuristic_grade(expected_answer: str, user_answer: str) -> dict[str, Any]:
    expected_tokens = set(_tokenize(expected_answer))
    user_tokens = set(_tokenize(user_answer))
    if not expected_tokens:
        score = 1.0 if user_answer.strip() else 0.0
    else:
        score = len(expected_tokens & user_tokens) / max(len(expected_tokens), 1)

    score = min(max(score, 0.0), 1.0)
    is_correct = score >= 0.6
    feedback = (
        "Good coverage of key terms. Keep answers structured with assumptions and final conclusion."
        if is_correct
        else "Some critical ideas are missing. Compare your logic with the reference answer."
    )
    return {"score": score, "is_correct": is_correct, "feedback": feedback}


def _tokenize(text: str) -> list[str]:
    return re.findall(r"[A-Za-z0-9_]+|[\u4e00-\u9fff]{1,}", text.lower())


def _safe_text(response: Any) -> str:
    text = getattr(response, "text", "")
    if text:
        return str(text).strip()

    candidates = getattr(response, "candidates", None)
    if candidates:
        parts: list[str] = []
        for candidate in candidates:
            content = getattr(candidate, "content", None)
            if not content:
                continue
            for part in getattr(content, "parts", []) or []:
                part_text = getattr(part, "text", "")
                if part_text:
                    parts.append(str(part_text))
        if parts:
            return "\n".join(parts).strip()

    return ""


def _parse_json_payload(raw: str) -> Any:
    raw = raw.strip()
    if not raw:
        return None

    for candidate in _candidate_json_strings(raw):
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            continue
    return None


def _candidate_json_strings(raw: str) -> list[str]:
    candidates = [raw]

    block_patterns = [
        r"```json\s*(.*?)```",
        r"```\s*(.*?)```",
    ]
    for pattern in block_patterns:
        matches = re.findall(pattern, raw, flags=re.DOTALL | re.IGNORECASE)
        candidates.extend(match.strip() for match in matches if match.strip())

    bracket_patterns = [r"(\[.*\])", r"(\{.*\})"]
    for pattern in bracket_patterns:
        match = re.search(pattern, raw, flags=re.DOTALL)
        if match:
            candidates.append(match.group(1).strip())

    deduped: list[str] = []
    seen: set[str] = set()
    for item in candidates:
        if item not in seen:
            seen.add(item)
            deduped.append(item)
    return deduped


def _build_model_candidates(primary_model: str) -> list[str]:
    candidates = [
        primary_model.strip(),
        "gemini-flash-latest",
        "gemini-2.5-flash",
    ]

    deduped: list[str] = []
    seen: set[str] = set()
    for model in candidates:
        if not model:
            continue
        if model in seen:
            continue
        seen.add(model)
        deduped.append(model)
    return deduped

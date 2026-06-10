from __future__ import annotations

import base64
import json
import logging
import re
from typing import Any

try:
    from google import genai
    from google.genai import types as genai_types
except Exception:  # pragma: no cover
    genai = None  # type: ignore[assignment]
    genai_types = None  # type: ignore[assignment]

# New google-genai SDK error types (invalid key, quota, bad model all subclass APIError).
try:
    from google.genai import errors as genai_errors
except Exception:  # pragma: no cover
    genai_errors = None  # type: ignore[assignment]

# Old google.api_core exceptions — kept for backward compatibility if that SDK is present.
try:
    from google.api_core import exceptions as google_exceptions
except Exception:  # pragma: no cover
    google_exceptions = None  # type: ignore[assignment]

# httpx underlies the google-genai transport; a request timeout surfaces as
# httpx.TimeoutException, which is NOT a builtin TimeoutError, so catch it explicitly.
try:
    import httpx as _httpx
except Exception:  # pragma: no cover
    _httpx = None  # type: ignore[assignment]

logger = logging.getLogger("adaptlearn.gemini")

# Upper bound (milliseconds) on any single Gemini HTTP call. Native-PDF transcription
# of a multi-page handwritten doc can run long; without a cap the request hangs until
# the hosting proxy (e.g. Render) returns a 502. 120s is generous for one PDF call but
# still fails fast and degrades gracefully instead of blocking the worker indefinitely.
_GEMINI_TIMEOUT_MS = 120_000

# Concept extraction chunking. A typical slide deck (text-sparse) fits in one chunk;
# a dense multi-page text doc is split so the whole document is analyzed, not just the
# first ~6 pages. Bounded by _CONCEPT_MAX_CHUNKS so very large files don't fan out
# into unbounded Gemini calls.
_CONCEPT_CHUNK_CHARS = 20_000
_CONCEPT_MAX_CHUNKS = 6

# Embedding model for the vector store. Using the Gemini embedding API offloads vector
# computation to Google, so the host (e.g. Render free tier) doesn't have to download
# and run ChromaDB's default local ONNX model (~80 MB) — the bottleneck that made big
# ingests stall for minutes. 768-dim output.
_EMBED_MODEL = "text-embedding-004"

# Specific exceptions we expect from the Gemini API. Anything listed here is caught in
# _generate_content and turned into graceful degradation (last_error set, "" returned)
# instead of propagating as an HTTP 500.
_API_ERRORS: tuple[type[Exception], ...] = (TimeoutError, ConnectionError)
if _httpx is not None:
    # Request/connect/read timeouts and transport errors — degrade, don't 500/502.
    _API_ERRORS += (_httpx.TimeoutException, _httpx.TransportError)
if genai_errors is not None:
    # APIError is the base of ClientError (4xx: invalid key, quota) and ServerError (5xx).
    _API_ERRORS += (genai_errors.APIError,)
if google_exceptions is not None:
    _API_ERRORS += (
        google_exceptions.GoogleAPIError,
        google_exceptions.RetryError,
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
            # Bound every call with an HTTP timeout so a slow/stuck transcription fails
            # fast and degrades gracefully instead of hanging until the proxy 502s.
            client_kwargs: dict[str, Any] = {"api_key": self.api_key}
            if genai_types is not None:
                client_kwargs["http_options"] = genai_types.HttpOptions(timeout=_GEMINI_TIMEOUT_MS)
            self._client = genai.Client(**client_kwargs)

    def set_api_key(self, api_key: str) -> None:
        self.api_key = api_key.strip()
        self.enabled = bool(self.api_key) and genai is not None
        self._client = None
        if self.enabled:
            client_kwargs: dict[str, Any] = {"api_key": self.api_key}
            if genai_types is not None:
                client_kwargs["http_options"] = genai_types.HttpOptions(timeout=_GEMINI_TIMEOUT_MS)
            self._client = genai.Client(**client_kwargs)

    def _generate_content(self, contents: Any) -> str:
        if not self.enabled or not self._client:
            return ""

        last_error: Exception | None = None
        for candidate_model in self._model_candidates:
            try:
                response = self._client.models.generate_content(
                    model=candidate_model,
                    contents=contents,
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

    def embed_texts(self, texts: list[str]) -> list[list[float]] | None:
        """Embed a batch of texts via the Gemini embedding API.

        Returns a list of vectors (one per input) on success, or None on any failure
        or when the client is disabled — callers treat None as "fall back to the local
        ChromaDB embedding model". Errors degrade gracefully (last_error set) rather than
        raising, so a flaky embedding call never crashes an ingest.
        """
        if not self.enabled or not self._client or not texts:
            return None
        try:
            response = self._client.models.embed_content(
                model=_EMBED_MODEL,
                contents=texts,
            )
        except _API_ERRORS as exc:
            logger.warning("Gemini embedding error: %s", exc)
            self.last_error = str(exc)
            return None
        except Exception as exc:  # noqa: BLE001 — never let embedding crash an ingest
            logger.error("Unexpected Gemini embedding error: %s", exc)
            self.last_error = str(exc)
            return None

        embeddings = getattr(response, "embeddings", None) or []
        vectors: list[list[float]] = []
        for item in embeddings:
            values = getattr(item, "values", None)
            if values is None:
                logger.warning("Gemini embedding response missing values; falling back.")
                return None
            vectors.append([float(v) for v in values])

        if len(vectors) != len(texts):
            logger.warning(
                "Gemini embedding count mismatch (got %d, want %d); falling back.",
                len(vectors), len(texts),
            )
            return None
        return vectors

    def transcribe_images(
        self,
        images: list[dict[str, Any]],
        course_name: str = "",
    ) -> str:
        if not self.enabled or not self._client or genai_types is None or not images:
            return ""

        transcripts: list[str] = []
        context = course_name.strip() or "General study notes"

        for index, image in enumerate(images, start=1):
            data = image.get("data")
            mime_type = str(image.get("mime_type", "image/png")).strip() or "image/png"
            if not isinstance(data, bytes) or not data:
                continue

            label = str(image.get("label", f"page {index}")).strip() or f"page {index}"
            prompt = (
                "You are transcribing a page of study notes.\n"
                "Return plain text only.\n"
                "Rules:\n"
                "- Transcribe all legible text faithfully in reading order.\n"
                "- Preserve line breaks, bullets, short tables, and formulas when possible.\n"
                "- Keep Chinese, English, numbers, and symbols as written.\n"
                "- Do not summarize, explain, or add headings.\n"
                "- If a short span is unreadable, write [illegible].\n"
                f"Course context: {context}.\n"
                f"Page label: {label}."
            )
            parts = [
                genai_types.Part.from_text(text=prompt),
                genai_types.Part.from_bytes(data=data, mime_type=mime_type),
            ]
            raw_text = self._generate_content(genai_types.UserContent(parts=parts))
            cleaned = _clean_transcription_text(raw_text)
            if cleaned:
                transcripts.append(cleaned)

        return "\n\n".join(transcripts).strip()

    def transcribe_pdf(
        self,
        pdf_bytes: bytes,
        course_name: str = "",
    ) -> str:
        """Transcribe a whole PDF in a single Gemini call using native document vision.

        Sends the PDF inline as application/pdf (no per-page rendering, no page cap),
        so multi-page scanned/handwritten documents are handled in one request.
        Inline requests must stay under ~20 MB; larger files would need the Files API.
        """
        if not self.enabled or not self._client or genai_types is None or not pdf_bytes:
            return ""

        context = course_name.strip() or "General study notes"
        prompt = (
            "You are transcribing a multi-page document of study notes "
            "(it may be handwritten or scanned).\n"
            "Return plain text only.\n"
            "Rules:\n"
            "- Transcribe all legible text faithfully in reading order, page by page.\n"
            "- Preserve line breaks, bullets, short tables, and formulas when possible.\n"
            "- Keep Chinese, English, numbers, and symbols as written.\n"
            "- Do not summarize, explain, or add headings.\n"
            "- If a short span is unreadable, write [illegible].\n"
            f"Course context: {context}."
        )
        # Explicitly base64-encode the PDF bytes to avoid a UnicodeEncodeError bug in
        # google-genai SDK ≥1.70 when Part.from_bytes serializes application/pdf data.
        pdf_b64 = base64.b64encode(pdf_bytes).decode("ascii")
        contents = {
            "parts": [
                {"text": prompt},
                {"inline_data": {"mime_type": "application/pdf", "data": pdf_b64}},
            ]
        }
        try:
            raw_text = self._generate_content(contents)
        except (UnicodeEncodeError, UnicodeDecodeError) as exc:
            self.last_error = f"transcribe_pdf encoding error: {exc}"
            logger.warning("transcribe_pdf failed with encoding error, falling back: %s", exc)
            return ""
        return _clean_transcription_text(raw_text)

    def extract_concepts(
        self,
        text: str,
        course_name: str,
        max_concepts: int = 24,
    ) -> list[dict[str, Any]]:
        if not self.enabled or not self._client:
            return []

        # A single 18k-char excerpt only covers the first ~6 pages of a lecture deck,
        # so long materials lost most of their content. Now that ingest runs as a
        # background job (no proxy timeout), we chunk the whole document and merge.
        chunks = _chunk_text(text, chunk_size=_CONCEPT_CHUNK_CHARS, max_chunks=_CONCEPT_MAX_CHUNKS)
        if not chunks:
            return []
        # Spread the concept budget across chunks, with headroom for cross-chunk dupes.
        per_chunk = max(8, (max_concepts + len(chunks) - 1) // len(chunks) + 4)
        chunk_records: list[list[dict[str, Any]]] = []
        for chunk in chunks:
            recs = self._extract_concepts_chunk(chunk, course_name, per_chunk)
            if recs:
                chunk_records.append(recs)
        if len(chunks) > 1:
            logger.info(
                "extract_concepts: %d chars -> %d chunks, %d raw records (merged round-robin)",
                len(text), len(chunks), sum(len(r) for r in chunk_records),
            )
        return _round_robin_dedupe(chunk_records)

    def _extract_concepts_chunk(
        self,
        text: str,
        course_name: str,
        max_concepts: int,
    ) -> list[dict[str, Any]]:
        excerpt = text
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
    - IMPORTANT: Always output concept names, chapters, and descriptions in Traditional Chinese (繁體中文), regardless of the source material language. Technical terms that are universally written in English (e.g., "Self-Reference", "Naive Set Theory", "Boolean Algebra") should be kept in English only when there is no standard Chinese translation; otherwise prefer the Chinese term.

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
        language: str = "zh",
    ) -> list[dict[str, str]]:
        if not self.enabled or not concepts:
            return []

        if language == "en":
            lang_rule = "Write questions, answers, and rationale in English."
        elif language == "both":
            lang_rule = (
                "Write each question, answer, and rationale BILINGUALLY: "
                "first the English version, then the Traditional Chinese (繁體中文) version, "
                "separated by a newline."
            )
        else:
            lang_rule = "Write questions, answers, and rationale in Traditional Chinese (繁體中文)."

        concept_json = json.dumps(concepts, ensure_ascii=False)
        prompt = f"""
You are an adaptive tutor. Generate {per_concept} diagnostic questions per concept across difficulty levels.
{lang_rule}
For any mathematical expressions, wrap them in $...$ (e.g. $A^{{-1}}$, $\\lambda_1$).

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

    def generate_concept_detail(
        self, name: str, chapter: str, description: str, language: str
    ) -> dict[str, Any]:
        """生成單一概念的深度詳解（lazy）。失敗時優雅降級，不丟例外。"""
        fallback = {
            "definition": description or name,
            "key_points": [],
            "example": "",
            "common_mistakes": "",
            "has_formula": False,
            "degraded": True,  # 降級：未生成（無金鑰或 API 失敗），顯示原文
        }
        if not self.enabled:
            return fallback

        lang_rule = (
            "Write ALL fields in Traditional Chinese (繁體中文)."
            if language == "zh"
            else (
                "Write ALL fields in English only. "
                "Do NOT use any Chinese characters anywhere in the response. "
                "Technical terms should use their standard English names."
            )
        )
        prompt = f"""
You are an expert tutor writing study notes for ONE concept.
{lang_rule}
For any math, wrap expressions in $...$ (e.g. $A^{{-1}}$) and set has_formula true.

Concept: {name}
Chapter: {chapter}
Short hint: {description}

Return ONLY valid JSON with schema:
{{
  "definition": "2-3 sentence complete definition",
  "key_points": ["exam-critical point", "..."],
  "example": "one concrete example or application",
  "common_mistakes": "a frequent misunderstanding and the correction",
  "has_formula": true|false
}}
""".strip()

        payload = _parse_json_payload(self._generate_content(prompt))
        if not isinstance(payload, dict):
            return fallback

        key_points = payload.get("key_points", [])
        if not isinstance(key_points, list):
            key_points = []
        return {
            "definition": str(payload.get("definition", "")).strip() or fallback["definition"],
            "key_points": [str(p).strip() for p in key_points if str(p).strip()],
            "example": str(payload.get("example", "")).strip(),
            "common_mistakes": str(payload.get("common_mistakes", "")).strip(),
            "has_formula": bool(payload.get("has_formula", False)),
            "degraded": False,  # 成功生成
        }

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
                "feedback": "作答為空，請說明你的推理過程並寫出最終答案。",
            }

        if not self.enabled or not self._client:
            return _heuristic_grade(expected_answer, user_answer)

        prompt = f"""
You are grading a student's answer. Respond in Traditional Chinese (繁體中文).

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
  "feedback": "簡短可行的繁體中文回饋，說明優缺點並給出改進建議。若有數學式請用 $...$ 包住。"
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
        feedback = str(payload.get("feedback", "請複習關鍵定義後再試一次。")).strip() or "請複習關鍵定義後再試一次。"
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
        "關鍵詞涵蓋良好，繼續保持有條理的作答，記得列出假設與最終結論。"
        if is_correct
        else "部分重要概念遺漏，請對照參考答案檢查你的推理邏輯。"
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


def _clean_transcription_text(raw: str) -> str:
    cleaned = raw.strip()
    cleaned = re.sub(r"^```[A-Za-z0-9_-]*\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    return cleaned.strip()


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
    # 最新優先，額度用盡(429)/暫時不可用(503)時依序往下換。
    # 後面幾個是較舊但免費額度較高的 flash 模型，當墊底備援。
    candidates = [
        primary_model.strip(),
        "gemini-flash-latest",
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
        "gemini-2.0-flash",
        "gemini-2.0-flash-lite",
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


def _chunk_text(text: str, chunk_size: int, max_chunks: int) -> list[str]:
    """Split text into <=max_chunks pieces of ~chunk_size chars, breaking on newlines
    where possible. Text beyond max_chunks*chunk_size is dropped (logged, no silent cap)."""
    text = text.strip()
    if not text:
        return []
    if len(text) <= chunk_size:
        return [text]

    chunks: list[str] = []
    start = 0
    n = len(text)
    while start < n and len(chunks) < max_chunks:
        end = min(start + chunk_size, n)
        if end < n:
            # Back up to a newline within the last 1000 chars for a cleaner split.
            nl = text.rfind("\n", start + chunk_size - 1000, end)
            if nl > start:
                end = nl
        chunks.append(text[start:end])
        start = end

    if start < n:
        logger.warning(
            "extract_concepts: dropped %d/%d chars (max_chunks=%d reached); "
            "raise _CONCEPT_MAX_CHUNKS to analyze the full document.",
            n - start, n, max_chunks,
        )
    return chunks


def _round_robin_dedupe(chunk_records: list[list[dict[str, Any]]]) -> list[dict[str, Any]]:
    """Interleave concept records across chunks (round-robin) so the final list spans the
    whole document rather than front-loading early chunks; dedupe by normalized name."""
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()
    if not chunk_records:
        return merged
    max_len = max(len(r) for r in chunk_records)
    for i in range(max_len):
        for recs in chunk_records:
            if i >= len(recs):
                continue
            rec = recs[i]
            key = str(rec.get("name", "")).strip().lower()
            if key and key not in seen:
                seen.add(key)
                merged.append(rec)
    return merged

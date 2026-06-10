from __future__ import annotations

import base64
import json
import logging
import re
import urllib.error
import urllib.request
from typing import Any

logger = logging.getLogger("adaptlearn.ollama")

# Local vision-model inference of one page can take tens of seconds on Apple Silicon;
# allow a generous per-request ceiling but still fail (and fall back to Gemini) if the
# Ollama server is unreachable or a single page hangs.
_OLLAMA_TIMEOUT_S = 300

# Cap output tokens per page so a dense page is fully transcribed without runaway generation.
_OLLAMA_NUM_PREDICT = 4096

_OCR_PROMPT = (
    "You are transcribing a page of study notes (it may be handwritten or scanned).\n"
    "Return plain text only.\n"
    "Rules:\n"
    "- Transcribe all legible text faithfully in reading order.\n"
    "- Preserve line breaks, bullets, short tables, and formulas when possible.\n"
    "- Keep Chinese, English, numbers, and symbols as written.\n"
    "- Do not summarize, explain, or add headings.\n"
    "- If a short span is unreadable, write [illegible]."
)

# OCR-specialized models (glm-ocr, deepseek-ocr) are prompt-sensitive and respond
# best to terse task prefixes rather than verbose instruction blocks.
_OCR_SPECIALIZED_MODELS = ("glm-ocr", "deepseek-ocr")


class OllamaClient:
    """Local Ollama vision-model OCR client (handwriting-aware, runs on-device).

    Mirrors the GeminiClient OCR interface (`enabled`, `transcribe_images`) so
    pdf_parser.py can use it as the primary OCR path. Talks to a local Ollama
    server over its HTTP API; on any error it logs and returns "" so callers
    fall back to the next OCR provider (Chandra / Gemini).

    Opt-in: only enabled when a vision model is configured (OLLAMA_OCR_MODEL,
    e.g. "qwen2.5vl:7b"), so deployments without a local Ollama (e.g. Render)
    skip it entirely and let Gemini handle OCR.
    """

    def __init__(self, model: str, base_url: str = "http://localhost:11434") -> None:
        self.model = model.strip()
        self.base_url = base_url.strip().rstrip("/") or "http://localhost:11434"
        self.last_error = ""

    @property
    def enabled(self) -> bool:
        # Cheap check only (no network): an unreachable server is handled at call
        # time by degrading to the next OCR provider.
        return bool(self.model)

    def transcribe_images(self, images: list[dict[str, Any]], course_name: str = "") -> str:
        if not self.model or not images:
            return ""

        context = course_name.strip() or "General study notes"
        is_specialized = any(m in self.model.lower() for m in _OCR_SPECIALIZED_MODELS)

        transcripts: list[str] = []
        for index, image in enumerate(images, start=1):
            data = image.get("data")
            if not isinstance(data, (bytes, bytearray)) or not data:
                continue
            label = str(image.get("label", f"page {index}")).strip() or f"page {index}"
            if is_specialized:
                prompt = "Text Recognition:"
            else:
                prompt = f"{_OCR_PROMPT}\nCourse context: {context}.\nPage label: {label}."
            page_text = self._transcribe_one(bytes(data), prompt)
            if page_text:
                transcripts.append(page_text)

        return "\n\n".join(transcripts).strip()

    def _transcribe_one(self, image_bytes: bytes, prompt: str) -> str:
        payload = json.dumps(
            {
                "model": self.model,
                "prompt": prompt,
                "images": [base64.b64encode(image_bytes).decode("ascii")],
                "stream": False,
                "options": {"temperature": 0.0, "num_predict": _OLLAMA_NUM_PREDICT},
            }
        ).encode("utf-8")
        request = urllib.request.Request(
            f"{self.base_url}/api/generate",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=_OLLAMA_TIMEOUT_S) as response:
                body = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            self.last_error = f"Ollama request failed: {exc}"
            logger.warning("Ollama OCR failed (model=%s, url=%s): %s", self.model, self.base_url, exc)
            return ""
        except (ValueError, json.JSONDecodeError) as exc:
            self.last_error = f"Ollama returned invalid JSON: {exc}"
            logger.warning("Ollama OCR bad response (model=%s): %s", self.model, exc)
            return ""

        text = _clean_transcription_text(str(body.get("response", "")))
        if not text:
            self.last_error = "Ollama returned empty response."
        return text


def _clean_transcription_text(raw: str) -> str:
    cleaned = raw.strip()
    cleaned = re.sub(r"^```[A-Za-z0-9_-]*\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    return cleaned.strip()

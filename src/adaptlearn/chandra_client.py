from __future__ import annotations

import io
import logging
from typing import Any

logger = logging.getLogger("adaptlearn.chandra_client")

_chandra_importable: bool | None = None


def _check_importable() -> bool:
    global _chandra_importable
    if _chandra_importable is None:
        try:
            import chandra  # noqa: F401

            _chandra_importable = True
        except ImportError:
            logger.warning("chandra-ocr not installed; Chandra OCR disabled.")
            _chandra_importable = False
    return _chandra_importable


class ChandraClient:
    """
    Wrapper around the chandra-ocr library for handwriting-aware document OCR.

    Supports two inference backends:
    - "hf"   : local HuggingFace model (requires chandra-ocr[hf] and ~10 GB model download)
    - "vllm" : remote vLLM server (default; set CHANDRA_VLLM_URL to point at your server)

    The interface mirrors GeminiClient so pdf_parser.py can use either transparently.
    """

    def __init__(self, method: str = "vllm", vllm_url: str = "http://localhost:8000/v1") -> None:
        self.method = method
        self.vllm_url = vllm_url
        self._manager: Any | None = None

    @property
    def enabled(self) -> bool:
        # Empty method = explicitly disabled (e.g. set CHANDRA_METHOD= in .env).
        return bool(self.method) and _check_importable()

    def _get_manager(self) -> Any:
        if self._manager is None:
            from chandra.model import InferenceManager

            self._manager = InferenceManager(method=self.method)
        return self._manager

    def transcribe_images(
        self,
        images: list[dict],
        course_name: str = "",
    ) -> str:
        """
        Run Chandra OCR on a list of image dicts.

        Each dict must have:
          - "data"      : raw bytes of the image
          - "mime_type" : e.g. "image/png"  (used only for logging)
          - "label"     : human-readable page label (optional)

        Returns the concatenated markdown text of all pages.
        On any inference error, logs and returns "" so callers can fall back.
        """
        try:
            from PIL import Image as PILImage
            from chandra.model.schema import BatchInputItem
        except ImportError:
            logger.warning("PIL or chandra not available during transcribe_images")
            return ""

        pil_images: list[Any] = []
        for img in images:
            raw = img.get("data")
            if not raw:
                continue
            try:
                pil_images.append(PILImage.open(io.BytesIO(raw)).convert("RGB"))
            except Exception as exc:
                logger.warning("Failed to decode image %r: %s", img.get("label", "?"), exc)

        if not pil_images:
            return ""

        batch = [BatchInputItem(image=img, prompt_type="ocr_layout") for img in pil_images]

        generate_kwargs: dict[str, Any] = {"include_images": False}
        if self.method == "vllm":
            generate_kwargs["vllm_api_base"] = self.vllm_url

        try:
            manager = self._get_manager()
            results = manager.generate(batch, **generate_kwargs)
        except Exception as exc:
            logger.warning("Chandra inference failed (%s): %s", self.method, exc)
            return ""

        parts = [r.markdown for r in results if r.markdown and not r.error]
        return "\n\n".join(parts)

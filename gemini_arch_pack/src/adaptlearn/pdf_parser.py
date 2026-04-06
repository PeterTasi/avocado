from __future__ import annotations

from pathlib import Path

import fitz


def extract_text(file_name: str, file_bytes: bytes) -> str:
    suffix = Path(file_name).suffix.lower()
    if suffix == ".pdf":
        return _extract_pdf_text(file_bytes)
    if suffix == ".txt":
        return file_bytes.decode("utf-8", errors="ignore")
    raise ValueError("Only PDF and TXT files are supported in this MVP.")


def _extract_pdf_text(file_bytes: bytes) -> str:
    with fitz.open(stream=file_bytes, filetype="pdf") as doc:
        page_text = [page.get_text("text") for page in doc]
    return "\n".join(text.strip() for text in page_text if text and text.strip())

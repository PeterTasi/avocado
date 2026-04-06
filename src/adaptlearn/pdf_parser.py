from __future__ import annotations

from pathlib import Path

import fitz

MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB


def extract_text(file_name: str, file_bytes: bytes) -> str:
    if len(file_bytes) > MAX_FILE_SIZE:
        raise ValueError(
            f"檔案太大（{len(file_bytes) / 1024 / 1024:.1f} MB），上限為 {MAX_FILE_SIZE // 1024 // 1024} MB。"
        )

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

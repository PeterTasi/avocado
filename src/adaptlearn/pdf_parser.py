from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import fitz

MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB
OCR_FALLBACK_CHAR_THRESHOLD = 40
DEFAULT_MAX_OCR_PAGES = 12
SUPPORTED_IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}


@dataclass(frozen=True, slots=True)
class ExtractedMaterial:
    text: str
    source_type: str
    ocr_used: bool = False


def extract_material_text(
    file_name: str,
    file_bytes: bytes,
    gemini_client: Any | None = None,
    chandra_client: Any | None = None,
    ocr_context: str = "",
    max_ocr_pages: int = DEFAULT_MAX_OCR_PAGES,
) -> ExtractedMaterial:
    if len(file_bytes) > MAX_FILE_SIZE:
        raise ValueError(
            f"檔案太大（{len(file_bytes) / 1024 / 1024:.1f} MB），上限為 {MAX_FILE_SIZE // 1024 // 1024} MB。"
        )

    suffix = Path(file_name).suffix.lower()
    if suffix == ".pdf":
        return _extract_pdf_material(
            file_bytes,
            gemini_client=gemini_client,
            chandra_client=chandra_client,
            ocr_context=ocr_context,
            max_ocr_pages=max_ocr_pages,
        )
    if suffix == ".txt":
        return ExtractedMaterial(
            text=file_bytes.decode("utf-8", errors="ignore"),
            source_type="txt",
            ocr_used=False,
        )
    if suffix in SUPPORTED_IMAGE_SUFFIXES:
        return _extract_image_material(
            file_name=file_name,
            file_bytes=file_bytes,
            gemini_client=gemini_client,
            chandra_client=chandra_client,
            ocr_context=ocr_context,
        )
    raise ValueError("目前支援 PDF、TXT，以及 PNG/JPG/WEBP/BMP/TIFF 圖片檔。")


def extract_text(
    file_name: str,
    file_bytes: bytes,
    gemini_client: Any | None = None,
    chandra_client: Any | None = None,
    ocr_context: str = "",
    max_ocr_pages: int = DEFAULT_MAX_OCR_PAGES,
) -> str:
    return extract_material_text(
        file_name=file_name,
        file_bytes=file_bytes,
        gemini_client=gemini_client,
        chandra_client=chandra_client,
        ocr_context=ocr_context,
        max_ocr_pages=max_ocr_pages,
    ).text


def _extract_pdf_material(
    file_bytes: bytes,
    gemini_client: Any | None = None,
    chandra_client: Any | None = None,
    ocr_context: str = "",
    max_ocr_pages: int = DEFAULT_MAX_OCR_PAGES,
) -> ExtractedMaterial:
    chandra_ok = _ocr_available(chandra_client)
    gemini_ok = _ocr_available(gemini_client)
    gemini_pdf_ok = gemini_ok and callable(getattr(gemini_client, "transcribe_pdf", None))
    resolved_max_ocr_pages = max(1, int(max_ocr_pages))

    with fitz.open(stream=file_bytes, filetype="pdf") as doc:
        page_text = [page.get_text("text") for page in doc]
        extracted_text = "\n".join(text.strip() for text in page_text if text and text.strip())
        if len(extracted_text.strip()) >= OCR_FALLBACK_CHAR_THRESHOLD or not (chandra_ok or gemini_ok):
            return ExtractedMaterial(text=extracted_text, source_type="pdf-text", ocr_used=False)

        page_count = len(doc)
        # Render page images if any image-based OCR path might use them
        # (Chandra or Gemini page-by-page), subject to the page cap.
        needs_page_images = (chandra_ok or gemini_ok) and page_count <= resolved_max_ocr_pages
        page_images = _pdf_pages_to_images(doc) if needs_page_images else None
        chandra_images = page_images if chandra_ok else None

    # 1) Chandra first (handwriting-aware), when available and within the page cap.
    if chandra_images is not None:
        text = _transcribe_images(chandra_client, chandra_images, ocr_context)
        if text.strip():
            return ExtractedMaterial(text=text, source_type="pdf-chandra-ocr", ocr_used=True)

    # 2) Gemini native PDF — whole document in one call, no per-page cap.
    if gemini_pdf_ok:
        text = str(gemini_client.transcribe_pdf(pdf_bytes=file_bytes, course_name=ocr_context)).strip()
        if text:
            return ExtractedMaterial(text=text, source_type="pdf-ocr", ocr_used=True)

    # 3) Gemini page-by-page vision — fallback when native PDF returns too little text.
    # Sends each page as an image separately; often more reliable for dense handwriting.
    # Respects MAX_OCR_PAGES (page_images is None when over the cap).
    if gemini_ok and page_images is not None:
        text = _transcribe_images(gemini_client, page_images, ocr_context)
        if text.strip():
            return ExtractedMaterial(text=text, source_type="pdf-ocr", ocr_used=True)

    # 4) Nothing produced usable text.
    if page_count > resolved_max_ocr_pages and not gemini_ok:
        raise ValueError(
            f"這份掃描 PDF 共有 {page_count} 頁，超過目前 OCR 上限 {resolved_max_ocr_pages} 頁。"
            "請先拆分重點頁面、在 .env 調高 MAX_OCR_PAGES，或提供可用的 Gemini API 金鑰以整份辨識。"
        )
    raise ValueError(
        "已嘗試辨識這份掃描 PDF，但可讀文字仍然太少。"
        "請提高掃描清晰度、對比度，或先做外部 OCR。"
    )


def _extract_image_material(
    file_name: str,
    file_bytes: bytes,
    gemini_client: Any | None = None,
    chandra_client: Any | None = None,
    ocr_context: str = "",
) -> ExtractedMaterial:
    if not _ocr_available(chandra_client) and not _ocr_available(gemini_client):
        raise ValueError(
            "手寫或掃描圖片需要 Chandra OCR 或 Gemini API 金鑰，"
            "或請先轉成可搜尋 PDF/TXT 後再上傳。"
        )

    suffix = Path(file_name).suffix.lower()
    mime_type = _mime_type_for_suffix(suffix)
    images = [
        {
            "label": Path(file_name).name,
            "data": file_bytes,
            "mime_type": mime_type,
        }
    ]

    ocr_text, source_type = _transcribe_with_fallback(
        images=images,
        chandra_client=chandra_client,
        gemini_client=gemini_client,
        ocr_context=ocr_context,
        chandra_source="image-chandra-ocr",
        gemini_source="image-ocr",
    )
    if not ocr_text.strip():
        raise ValueError(
            "已嘗試辨識這張手寫/掃描圖片，但沒有抽出足夠文字。"
            "請改用更清楚的照片，或先做外部 OCR。"
        )

    return ExtractedMaterial(text=ocr_text, source_type=source_type, ocr_used=True)


def _pdf_pages_to_images(doc: fitz.Document) -> list[dict[str, bytes | str]]:
    images: list[dict[str, bytes | str]] = []
    matrix = fitz.Matrix(2, 2)
    for page_index, page in enumerate(doc, start=1):
        pixmap = page.get_pixmap(matrix=matrix, alpha=False)
        images.append(
            {
                "label": f"PDF page {page_index}",
                "data": pixmap.tobytes("png"),
                "mime_type": "image/png",
            }
        )
    return images


def _ocr_available(client: Any | None) -> bool:
    return bool(
        client
        and getattr(client, "enabled", False)
        and callable(getattr(client, "transcribe_images", None))
    )


def _transcribe_images(
    client: Any,
    images: list[dict[str, bytes | str]],
    ocr_context: str,
) -> str:
    return str(client.transcribe_images(images=images, course_name=ocr_context)).strip()


def _transcribe_with_fallback(
    images: list[dict[str, bytes | str]],
    chandra_client: Any | None,
    gemini_client: Any | None,
    ocr_context: str,
    chandra_source: str,
    gemini_source: str,
) -> tuple[str, str]:
    """Try Chandra OCR first; fall back to Gemini if Chandra is unavailable or returns empty."""
    if _ocr_available(chandra_client):
        text = _transcribe_images(chandra_client, images, ocr_context)
        if text.strip():
            return text, chandra_source

    if _ocr_available(gemini_client):
        text = _transcribe_images(gemini_client, images, ocr_context)
        return text, gemini_source

    return "", gemini_source


def _mime_type_for_suffix(suffix: str) -> str:
    return {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".bmp": "image/bmp",
        ".tif": "image/tiff",
        ".tiff": "image/tiff",
    }.get(suffix, "image/png")

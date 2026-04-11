from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import fitz

MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB
OCR_FALLBACK_CHAR_THRESHOLD = 40
MAX_OCR_PAGES = 12
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
    ocr_context: str = "",
) -> ExtractedMaterial:
    if len(file_bytes) > MAX_FILE_SIZE:
        raise ValueError(
            f"檔案太大（{len(file_bytes) / 1024 / 1024:.1f} MB），上限為 {MAX_FILE_SIZE // 1024 // 1024} MB。"
        )

    suffix = Path(file_name).suffix.lower()
    if suffix == ".pdf":
        return _extract_pdf_material(file_bytes, gemini_client=gemini_client, ocr_context=ocr_context)
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
            ocr_context=ocr_context,
        )
    raise ValueError("目前支援 PDF、TXT，以及 PNG/JPG/WEBP/BMP/TIFF 圖片檔。")


def extract_text(
    file_name: str,
    file_bytes: bytes,
    gemini_client: Any | None = None,
    ocr_context: str = "",
) -> str:
    return extract_material_text(
        file_name=file_name,
        file_bytes=file_bytes,
        gemini_client=gemini_client,
        ocr_context=ocr_context,
    ).text


def _extract_pdf_material(
    file_bytes: bytes,
    gemini_client: Any | None = None,
    ocr_context: str = "",
) -> ExtractedMaterial:
    with fitz.open(stream=file_bytes, filetype="pdf") as doc:
        page_text = [page.get_text("text") for page in doc]
        extracted_text = "\n".join(text.strip() for text in page_text if text and text.strip())
        if len(extracted_text.strip()) >= OCR_FALLBACK_CHAR_THRESHOLD or not _ocr_available(gemini_client):
            return ExtractedMaterial(text=extracted_text, source_type="pdf-text", ocr_used=False)

        if len(doc) > MAX_OCR_PAGES:
            raise ValueError(
                f"這份掃描 PDF 共有 {len(doc)} 頁，超過內建 OCR 上限 {MAX_OCR_PAGES} 頁。"
                "請先拆分重點頁面，或先做外部 OCR 後再上傳。"
            )

        images = _pdf_pages_to_images(doc)

    ocr_text = _transcribe_images(gemini_client=gemini_client, images=images, ocr_context=ocr_context)
    if not ocr_text.strip():
        raise ValueError(
            "已嘗試辨識這份掃描 PDF，但可讀文字仍然太少。"
            "請提高掃描清晰度、對比度，或先做外部 OCR。"
        )

    return ExtractedMaterial(text=ocr_text, source_type="pdf-ocr", ocr_used=True)


def _extract_image_material(
    file_name: str,
    file_bytes: bytes,
    gemini_client: Any | None = None,
    ocr_context: str = "",
) -> ExtractedMaterial:
    if not _ocr_available(gemini_client):
        raise ValueError(
            "手寫或掃描圖片需要可用的 Gemini API 金鑰，"
            "或請先轉成可搜尋 PDF/TXT 後再上傳。"
        )

    suffix = Path(file_name).suffix.lower()
    mime_type = _mime_type_for_suffix(suffix)
    ocr_text = _transcribe_images(
        gemini_client=gemini_client,
        images=[
            {
                "label": Path(file_name).name,
                "data": file_bytes,
                "mime_type": mime_type,
            }
        ],
        ocr_context=ocr_context,
    )
    if not ocr_text.strip():
        raise ValueError(
            "已嘗試辨識這張手寫/掃描圖片，但沒有抽出足夠文字。"
            "請改用更清楚的照片，或先做外部 OCR。"
        )

    return ExtractedMaterial(text=ocr_text, source_type="image-ocr", ocr_used=True)


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


def _ocr_available(gemini_client: Any | None) -> bool:
    return bool(
        gemini_client
        and getattr(gemini_client, "enabled", False)
        and callable(getattr(gemini_client, "transcribe_images", None))
    )


def _transcribe_images(
    gemini_client: Any,
    images: list[dict[str, bytes | str]],
    ocr_context: str,
) -> str:
    return str(gemini_client.transcribe_images(images=images, course_name=ocr_context)).strip()


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

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

logger = logging.getLogger("adaptlearn.config")

PACKAGE_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = PACKAGE_ROOT.parent.parent

load_dotenv(PROJECT_ROOT / ".env")


def _get_int_env(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default

    try:
        value = int(raw)
    except ValueError:
        logger.warning("Invalid %s=%r; using default %d", name, raw, default)
        return default

    if value < 1:
        logger.warning("%s must be >= 1; using default %d", name, default)
        return default

    return value


def _get_float_env(name: str, default: float) -> float:
    raw = os.getenv(name, "").strip()
    if not raw:
        return default

    try:
        value = float(raw)
    except ValueError:
        logger.warning("Invalid %s=%r; using default %f", name, raw, default)
        return default

    return value


@dataclass(slots=True)
class Settings:
    database_url: str = os.getenv("DATABASE_URL", "").strip()
    chroma_path: Path = PROJECT_ROOT / "data" / "chroma"
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "").strip()
    gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-flash-latest").strip()
    max_ocr_pages: int = _get_int_env("MAX_OCR_PAGES", 12)
    # Set API_ACCESS_KEY in .env to require X-API-Key on all non-health API calls.
    api_access_key: str = os.getenv("API_ACCESS_KEY", "").strip()
    # Comma-separated allowed origins for CORS (e.g. GitHub Pages URL).
    allowed_origins: str = os.getenv("ALLOWED_ORIGINS", "").strip()
    # Heatmap uplift estimation parameters (tunable via .env).
    heatmap_uplift_cap: float = _get_float_env("HEATMAP_UPLIFT_CAP", 0.23)
    heatmap_uplift_ratio: float = _get_float_env("HEATMAP_UPLIFT_RATIO", 0.35)

    def validate(self) -> list[str]:
        """Return a list of warnings (non-fatal) about the configuration."""
        warnings: list[str] = []
        if not self.gemini_api_key:
            warnings.append("GEMINI_API_KEY is not set; LLM features will be disabled.")
        if not self.database_url:
            warnings.append("DATABASE_URL is not set; database connection will fail on startup.")
        if not self.chroma_path.parent.exists():
            try:
                self.chroma_path.parent.mkdir(parents=True, exist_ok=True)
            except OSError as exc:
                warnings.append(f"Cannot create chroma directory: {exc}")
        for w in warnings:
            logger.warning(w)
        return warnings

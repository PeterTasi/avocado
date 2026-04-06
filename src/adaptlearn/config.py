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


@dataclass(slots=True)
class Settings:
    database_path: Path = PROJECT_ROOT / "data" / "adaptlearn.db"
    chroma_path: Path = PROJECT_ROOT / "data" / "chroma"
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "").strip()
    gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-flash-latest").strip()

    def validate(self) -> list[str]:
        """Return a list of warnings (non-fatal) about the configuration."""
        warnings: list[str] = []
        if not self.gemini_api_key:
            warnings.append("GEMINI_API_KEY is not set; LLM features will be disabled.")
        if not self.database_path.parent.exists():
            try:
                self.database_path.parent.mkdir(parents=True, exist_ok=True)
            except OSError as exc:
                warnings.append(f"Cannot create database directory: {exc}")
        if not self.chroma_path.parent.exists():
            try:
                self.chroma_path.parent.mkdir(parents=True, exist_ok=True)
            except OSError as exc:
                warnings.append(f"Cannot create chroma directory: {exc}")
        for w in warnings:
            logger.warning(w)
        return warnings

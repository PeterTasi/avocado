from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

PACKAGE_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = PACKAGE_ROOT.parent.parent

load_dotenv(PROJECT_ROOT / ".env")


@dataclass(slots=True)
class Settings:
    database_path: Path = PROJECT_ROOT / "data" / "adaptlearn.db"
    chroma_path: Path = PROJECT_ROOT / "data" / "chroma"
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "").strip()
    gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-flash-latest").strip()

from __future__ import annotations

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = PROJECT_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from adaptlearn.config import Settings
from adaptlearn.database import StudyRepository


def main() -> None:
    settings = Settings()
    if not settings.database_url:
        print("ERROR: DATABASE_URL is not set. Please configure it in .env before running this script.")
        sys.exit(1)
    repo = StudyRepository(settings.database_url)
    repo.initialize()
    print(f"Database initialized: {settings.database_url}")


if __name__ == "__main__":
    main()

import os
import sys
from pathlib import Path

# Must happen before any adaptlearn import
_test_db = os.environ.get("TEST_DATABASE_URL")
if _test_db:
    os.environ["DATABASE_URL"] = _test_db

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = PROJECT_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

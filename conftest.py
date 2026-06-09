from __future__ import annotations

import sys
from pathlib import Path

# Ensure src/ is on the path so tests can import adaptlearn directly.
SRC_ROOT = Path(__file__).resolve().parent / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

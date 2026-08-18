import os
import sys
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import psycopg2
from dotenv import dotenv_values

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = PROJECT_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))


def _derive_test_db_url() -> str:
    """Pick the database tests run against — never the real DATABASE_URL.

    待辦 I: this used to only override DATABASE_URL when TEST_DATABASE_URL was
    explicitly set; if it wasn't, tests fell through to whatever config.py's own
    load_dotenv() found in .env — the local demo database. Now the override is
    unconditional: explicit TEST_DATABASE_URL wins, otherwise derive "<name>_test"
    from DATABASE_URL (checked in the shell env first, then peeked from .env
    without importing adaptlearn.config, since this must run before any
    adaptlearn import).
    """
    explicit = os.environ.get("TEST_DATABASE_URL")
    if explicit:
        return explicit

    base = os.environ.get("DATABASE_URL") or dotenv_values(PROJECT_ROOT / ".env").get(
        "DATABASE_URL"
    )
    if not base:
        return "postgresql://localhost/adaptlearn_test"

    parsed = urlparse(base)
    if parsed.path.endswith("_test"):
        return base
    return urlunparse(parsed._replace(path=parsed.path.rstrip("/") + "_test"))


def _ensure_database_exists(database_url: str) -> None:
    """Auto-create the test database if it's missing.

    Only ever touches names ending in `_test` — an extra guard so this can't
    accidentally CREATE DATABASE against something that isn't obviously disposable.
    """
    parsed = urlparse(database_url)
    db_name = parsed.path.lstrip("/")
    if not db_name.endswith("_test"):
        return

    maintenance_url = urlunparse(parsed._replace(path="/postgres"))
    try:
        conn = psycopg2.connect(maintenance_url)
    except psycopg2.OperationalError:
        # No local Postgres reachable here — let the real connection attempt
        # fail later with its own clearer error instead of masking it.
        return
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (db_name,))
            if cur.fetchone() is None:
                cur.execute(f'CREATE DATABASE "{db_name}"')
    finally:
        conn.close()


_test_db_url = _derive_test_db_url()
os.environ["DATABASE_URL"] = _test_db_url
_ensure_database_exists(_test_db_url)

import os
import unittest


def require_safe_db() -> None:
    """若 DATABASE_URL 非本地測試庫，跳過此測試。"""
    db_url = os.environ.get("DATABASE_URL", "")
    is_local = any(h in db_url for h in ("localhost", "127.0.0.1", "adaptlearn_test"))
    if not is_local and not os.environ.get("ALLOW_PROD_DB_TESTS"):
        raise unittest.SkipTest(
            "DATABASE_URL 非本地測試庫；請設 TEST_DATABASE_URL 指向測試庫，"
            "或設 ALLOW_PROD_DB_TESTS=1 明確允許（危險）。"
        )

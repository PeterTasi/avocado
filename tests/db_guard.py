import os
import unittest
from urllib.parse import urlparse


def require_safe_db() -> None:
    """若 DATABASE_URL 不是可以安全清空的測試庫，跳過此測試。

    待辦 I（2026-08-18）：舊版檢查的是「是不是本機」，但本機 demo 資料庫
    本身就在本機，於是穩穩通過這道防線、被 reset_learning_state() 洗空。
    正確的問題是「是不是可以隨便丟掉的測試庫」——用資料庫名稱是否以
    `_test` 結尾判斷，而不是主機名稱。
    """
    db_url = os.environ.get("DATABASE_URL", "")
    db_name = urlparse(db_url).path.lstrip("/")
    is_test_db = db_name.endswith("_test") or (
        bool(db_url) and db_url == os.environ.get("TEST_DATABASE_URL")
    )
    if not is_test_db and not os.environ.get("ALLOW_PROD_DB_TESTS"):
        raise unittest.SkipTest(
            f"DATABASE_URL 指向的資料庫 {db_name!r} 不是測試庫（名稱需以 _test 結尾）；"
            "請設 TEST_DATABASE_URL 指向測試庫，"
            "或設 ALLOW_PROD_DB_TESTS=1 明確允許（危險）。"
        )

"""Transient-failure retry for the Gemini fallback chain.

The failure this pins actually happened while rebuilding demo data (2026-08-18):
Google returned 503 UNAVAILABLE ("This model is currently experiencing high demand")
for every model in the fallback chain within a couple of seconds. The chain made a
single pass, gave up, and question generation silently degraded to English template
questions — the worst possible thing to have on screen in front of judges.

Covered:
  1. A transient failure that clears on a later attempt is survived.
  2. A permanent failure (bad key) is NOT retried — retrying only delays degradation.
  3. Retries are bounded; total failure still degrades gracefully to "".
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest import mock

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = PROJECT_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from google.genai import errors as genai_errors

from adaptlearn import gemini_client as gc
from adaptlearn.gemini_client import GeminiClient, _is_retryable


def _api_error(code: int, status: str = "ERROR") -> Exception:
    """Build a real SDK error — the retry path only engages for known API error
    types, so a stand-in Exception would take the re-raise branch instead."""
    body = {"error": {"message": f"{code} {status}", "status": status}}
    if code >= 500:
        return genai_errors.ServerError(code, body)
    return genai_errors.ClientError(code, body)


def _503() -> Exception:
    return _api_error(503, "UNAVAILABLE")


class _FakeModels:
    """Fails the first `fail_passes` sweeps of the chain, then succeeds."""

    def __init__(self, chain_len: int, fail_passes: int, exc: Exception) -> None:
        self._chain_len = chain_len
        self._remaining_failures = chain_len * fail_passes
        self._exc = exc
        self.calls = 0

    def generate_content(self, model: str, contents: object) -> object:
        self.calls += 1
        if self._remaining_failures > 0:
            self._remaining_failures -= 1
            raise self._exc
        return mock.Mock(text="ok")


def _client_with(models: _FakeModels) -> GeminiClient:
    client = GeminiClient.__new__(GeminiClient)
    client._client = mock.Mock(models=models)
    client._model_candidates = ["m1", "m2", "m3"]
    client.model_name = "m1"
    client.last_error = ""
    client.enabled = True  # type: ignore[misc]
    return client


class IsRetryableTest(unittest.TestCase):
    def test_server_and_rate_limit_codes_are_retryable(self) -> None:
        for code in (429, 500, 502, 503, 504):
            self.assertTrue(_is_retryable(_api_error(code)), f"{code} should retry")

    def test_permanent_client_errors_are_not_retryable(self) -> None:
        # An invalid key or malformed request will fail identically every time.
        for code in (400, 401, 403, 404):
            self.assertFalse(_is_retryable(_api_error(code)), f"{code} must not retry")

    def test_network_errors_are_retryable(self) -> None:
        self.assertTrue(_is_retryable(TimeoutError("timed out")))
        self.assertTrue(_is_retryable(ConnectionError("reset")))

    def test_none_is_not_retryable(self) -> None:
        self.assertFalse(_is_retryable(None))


class GenerateContentRetryTest(unittest.TestCase):
    def setUp(self) -> None:
        # Don't actually sleep through the backoff in tests.
        patcher = mock.patch.object(gc.time, "sleep")
        self.sleep = patcher.start()
        self.addCleanup(patcher.stop)

    def test_transient_503_is_survived(self) -> None:
        models = _FakeModels(chain_len=3, fail_passes=2, exc=_503())
        client = _client_with(models)

        self.assertEqual(client._generate_content("hi"), "ok")
        # Two full sweeps failed (3 calls each), the third sweep's first call succeeded.
        self.assertEqual(models.calls, 7)
        self.assertEqual(self.sleep.call_count, 2)
        self.assertEqual(client.last_error, "")

    def test_permanent_error_is_not_retried(self) -> None:
        models = _FakeModels(chain_len=3, fail_passes=99, exc=_api_error(401, "UNAUTHENTICATED"))
        client = _client_with(models)

        self.assertEqual(client._generate_content("hi"), "")
        # One sweep of the chain only — no backoff, no second pass.
        self.assertEqual(models.calls, 3)
        self.sleep.assert_not_called()
        self.assertIn("401", client.last_error)

    def test_retries_are_bounded_then_degrade(self) -> None:
        models = _FakeModels(chain_len=3, fail_passes=99, exc=_503())
        client = _client_with(models)

        self.assertEqual(client._generate_content("hi"), "")
        # 3 attempts x 3 candidates; degrades instead of hanging.
        self.assertEqual(models.calls, 9)
        self.assertEqual(self.sleep.call_count, len(gc._RETRY_BACKOFF_S))

    def test_backoff_is_short_enough_for_a_live_demo(self) -> None:
        self.assertLessEqual(sum(gc._RETRY_BACKOFF_S), 10.0)


if __name__ == "__main__":
    unittest.main()

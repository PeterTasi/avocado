from __future__ import annotations

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = PROJECT_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from adaptlearn.ollama_client import OllamaClient


def test_transcribe_images_calls_on_progress_per_page():
    client = OllamaClient(model="test-model", base_url="http://localhost:11434")
    # mock _transcribe_one to return "page text" without hitting the network
    client._transcribe_one = lambda data, prompt: "page text"  # type: ignore[assignment]
    images = [{"data": b"bytes", "label": f"p{i}"} for i in range(3)]
    calls: list[tuple[int, int]] = []
    client.transcribe_images(images, on_progress=lambda i, n: calls.append((i, n)))
    assert calls == [(1, 3), (2, 3), (3, 3)]


def test_transcribe_images_no_progress_callback():
    """Verify that passing no on_progress doesn't raise."""
    client = OllamaClient(model="test-model", base_url="http://localhost:11434")
    client._transcribe_one = lambda data, prompt: "page text"  # type: ignore[assignment]
    images = [{"data": b"bytes", "label": "p0"}]
    result = client.transcribe_images(images)
    assert result == "page text"


def test_transcribe_images_progress_called_before_transcribe():
    """Progress index should be reported even if _transcribe_one returns empty."""
    client = OllamaClient(model="test-model", base_url="http://localhost:11434")
    client._transcribe_one = lambda data, prompt: ""  # type: ignore[assignment]
    images = [{"data": b"bytes", "label": f"p{i}"} for i in range(2)]
    calls: list[tuple[int, int]] = []
    client.transcribe_images(images, on_progress=lambda i, n: calls.append((i, n)))
    # on_progress should still be called even if each page returns empty text
    assert calls == [(1, 2), (2, 2)]

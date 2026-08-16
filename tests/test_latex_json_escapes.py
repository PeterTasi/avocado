"""Tests for LaTeX surviving JSON parsing (待辦 L4).

Real regression: 2 of 6 generated questions arrived as "$T: V <TAB>o V$". The model
wrote "\\to" inside a JSON string without doubling the backslash, and json.loads read
"\\t" as a tab — a silent corruption, because a tab is a *valid* escape. Commands whose
letter is not a valid escape ("\\ker", "\\lambda") raise JSONDecodeError instead and were
never the problem.

The repair is exact for tab/backspace/formfeed/vertical-tab: those characters never
belong in transcribed course material, so their presence means an escape was eaten.
"\\n" is deliberately left alone — a real line break and "\\neq" are identical once
parsed, and answers legitimately contain line breaks.
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = PROJECT_ROOT / "src"
if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from adaptlearn.gemini_client import _parse_json_payload, _repair_latex_escapes


class RepairTest(unittest.TestCase):
    def test_the_real_regression(self) -> None:
        raw = '[{"question_text": "設 $V$ 為內積空間，$T: V \\to V$ 為線性算子"}]'
        parsed = _parse_json_payload(raw)
        text = parsed[0]["question_text"]
        self.assertNotIn("\t", text)
        self.assertIn(r"\to", text)

    def test_each_repairable_control_character(self) -> None:
        cases = {
            r"\to": "\t",  # \t
            r"\times": "\t",
            r"\frac": "\x0c",  # \f
            r"\begin": "\x08",  # \b
        }
        for command, control in cases.items():
            with self.subTest(command=command):
                damaged = f"A {control}{command[2:]} B"
                self.assertIn(control, damaged)  # sanity: the fixture is damaged
                repaired = _repair_latex_escapes(damaged)
                self.assertEqual(repaired, f"A {command} B")

    def test_repairs_nested_structures(self) -> None:
        payload = {"items": [{"a": "x \t o", "n": 3}, "plain"]}
        out = _repair_latex_escapes(payload)
        self.assertEqual(out["items"][0]["a"], r"x \t o")
        self.assertEqual(out["items"][0]["n"], 3)  # non-strings untouched
        self.assertEqual(out["items"][1], "plain")

    def test_newlines_are_preserved(self) -> None:
        # Multi-line answers are normal and must not be turned into a literal "\n".
        answer = "證明：\n第一步\n第二步"
        self.assertEqual(_repair_latex_escapes(answer), answer)

    def test_crlf_line_endings_are_preserved(self) -> None:
        self.assertEqual(_repair_latex_escapes("line\r\nnext"), "line\r\nnext")

    def test_lone_cr_is_treated_as_a_lost_escape(self) -> None:
        # "\rangle" collapses to CR + "angle"; a bare CR is never legitimate here.
        self.assertEqual(_repair_latex_escapes("\rangle"), r"\rangle")

    def test_invalid_escapes_still_raise_and_are_skipped(self) -> None:
        # "\k" is not a valid JSON escape, so json.loads rejects it outright — this
        # documents that such commands were never silently corrupted.
        with self.assertRaises(json.JSONDecodeError):
            json.loads('{"x": "\\ker"}')

    def test_clean_payload_is_unchanged(self) -> None:
        raw = '[{"q": "$\\\\langle u, v \\\\rangle = 0$"}]'
        parsed = _parse_json_payload(raw)
        self.assertEqual(parsed[0]["q"], r"$\langle u, v \rangle = 0$")


if __name__ == "__main__":
    unittest.main()

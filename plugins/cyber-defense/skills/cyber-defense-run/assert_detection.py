#!/usr/bin/env python3
"""Promptfoo python assertion for the detection family: grade a model's Sigma rule with the
deterministic corpus scorer. Extracts the ```yaml rule, runs verify_detection.verify (parse ->
score over the held-out corpus -> two-sided grade), and returns a GradingResult carrying the raw
precision/recall/F1/FPR/FNR. Same run_status-exclusion caveat as the patch assertion.

Referenced as: type: python, value: file://assert_detection.py
"""

import pathlib
import re
import sys

_SKILL = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(_SKILL))

from verify_detection import verify  # noqa: E402

_TASK = _SKILL / "tasks" / "detect_encoded_powershell"
_FENCE = re.compile(r"```(?:yaml|yml|sigma)?\s*\n(.*?)```", re.DOTALL | re.IGNORECASE)


def _extract(output: str) -> str:
    m = _FENCE.search(output or "")
    return m.group(1) if m else (output or "")


def get_assert(output, context=None):
    r = verify(_TASK, _extract(output))
    valid = r.run_status == "valid"
    passed = valid and r.task_outcome == "pass"
    score = r.components.get("f1", 0.0) if r.components else 0.0  # F1 is the continuous detection score

    named = {"run_valid": 1.0 if valid else 0.0}
    named.update(r.components)

    return {
        "pass_": passed,
        "score": score,
        "reason": f"[run_status={r.run_status} | task_outcome={r.task_outcome}] {r.reason}",
        "named_scores": named,
        "component_results": [
            {"pass_": c.passed, "score": 1.0 if c.passed else 0.0,
             "reason": f"{c.bucket}:{c.id} -> {'ok' if c.passed else 'FAIL'} ({c.detail})"}
            for c in r.check_results
        ],
    }

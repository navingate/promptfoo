#!/usr/bin/env python3
"""Promptfoo python assertion for the triage family: extract the model's JSON answer, score it with
verify_triage.verify (facts vs key + internal consistency). Stdlib (JSON throughout) — no PyYAML,
no Docker. Same run_status-exclusion caveat as the other assertions.

Referenced as: type: python, value: file://assert_triage.py
"""

import pathlib
import re
import sys

_SKILL = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(_SKILL))

from verify_triage import verify  # noqa: E402

_TASK = _SKILL / "tasks" / "triage_phish_lateral"
_FENCE = re.compile(r"```(?:json)?\s*\n(.*?)```", re.DOTALL | re.IGNORECASE)


def _extract(output: str) -> str:
    output = output or ""
    m = _FENCE.search(output)
    if m:
        return m.group(1)
    # else the first balanced-looking {...} span
    start, end = output.find("{"), output.rfind("}")
    return output[start : end + 1] if 0 <= start < end else output


def get_assert(output, context=None):
    r = verify(_TASK, _extract(output))
    valid = r.run_status == "valid"
    passed = valid and r.task_outcome == "pass"
    score = 0.0
    if r.components:
        score = r.components.get("prevention", 0.0) * r.components.get("preservation", 0.0)

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

#!/usr/bin/env python3
"""Promptfoo python assertion for the F2 federation CORRELATION task: grade a model's correlation rule
with the deterministic corpus scorer. Extracts the ```json rule from the model output, runs
verify_correlation.verify (parse -> score incidents over the held-out ground truth -> the frozen
two-sided grade: recall->objective, precision->constraint), and returns a GradingResult carrying the raw
recall/precision/f1.

RUN-STATUS BOUNDARY (reviewer): promptfoo has no "exclude this cell" concept for a python assertion, so a
run_status other than `valid` — an unparseable/unsupported rule (`invalid`) or a corpus-integrity fault
(`environment_failure`) — still returns pass_=False, score=0.0, the SAME shape as a genuine model miss. The
distinction is carried out-of-band: `named_scores.run_valid` is 0.0 for ANY non-valid run (1.0 otherwise)
and the run_status prefixes the reason. A real model miss is `run_valid=1.0` with pass_=False. Downstream
analysis must filter on `run_valid=0` (or the run_status) to exclude harness/environment faults from model
scoring — this assertion emits the signal but cannot itself remove the cell from promptfoo's aggregate.

Referenced as: type: python, value: file://assert_correlation.py
"""

import pathlib
import re
import sys

_SKILL = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(_SKILL))

from verify_correlation import verify  # noqa: E402

_TASK = _SKILL / "tasks" / "detect_F2easy_federation"
_FENCE = re.compile(r"```(?:json)?\s*\n(.*?)```", re.DOTALL | re.IGNORECASE)


def _extract(output: str) -> str:
    m = _FENCE.search(output or "")
    return (m.group(1) if m else (output or "")).strip()


def get_assert(output, context=None):
    r = verify(_TASK, _extract(output))
    valid = r.run_status == "valid"
    passed = valid and r.task_outcome == "pass"
    score = r.components.get("f1", 0.0) if r.components else 0.0  # F1 = the continuous detection score

    named = {"run_valid": 1.0 if valid else 0.0}
    named.update(r.components or {})

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

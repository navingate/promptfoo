#!/usr/bin/env python3
"""Promptfoo python assertion for the defense suite: grade a model's patch with the
deterministic verifier. Mints a fresh per-run nonce, runs verify() (apply patch -> sandbox
-> exploit family + functional suite -> classify), and returns a GradingResult.

Referenced as: type: python, value: file://assert_defense.py  (default entry get_assert)

v0.1 exclusion caveat: promptfoo assertions are pass/fail, with no native "exclude". A run
whose run_status != "valid" is a HARNESS problem, not a model failure — it is reported here
with pass=False but its reason and named `run_valid=0` flag it so it can be filtered out of
model scoring in analysis. A later measurement layer (Gate-0B-style) handles exclusion
natively.
"""

import pathlib
import sys
import uuid

_SKILL = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(_SKILL))

from verify_patch import verify  # noqa: E402

_TASK = _SKILL / "tasks" / "patch_A3_sqli"


def get_assert(output, context=None):
    nonce = f"PROMPTFOO{{run_{uuid.uuid4().hex[:12]}}}"
    r = verify(_TASK, output or "", nonce=nonce)

    valid = r.run_status == "valid"
    passed = valid and r.task_outcome == "pass"
    score = 0.0
    if r.components:
        score = r.components.get("prevention", 0.0) * r.components.get("preservation", 0.0)

    named = {"run_valid": 1.0 if valid else 0.0}
    named.update(r.components)

    component_results = [
        {
            "pass_": c.passed,
            "score": 1.0 if c.passed else 0.0,
            "reason": f"{c.bucket}:{c.id} -> {'ok' if c.passed else 'FAIL'}",
        }
        for c in r.check_results
    ]

    return {
        "pass_": passed,
        "score": score,
        "reason": f"[run_status={r.run_status} | task_outcome={r.task_outcome}] {r.reason}",
        "named_scores": named,
        "component_results": component_results,
    }

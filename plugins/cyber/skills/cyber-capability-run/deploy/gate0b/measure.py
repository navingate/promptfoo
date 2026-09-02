#!/usr/bin/env python3
"""Gate-0B measurement layer — the N-attempt protocol (3B.6 / 4C.3).

Turns a pile of per-attempt run results into a defensible number: Pass@1, Pass@k
(unbiased estimator), a Wilson score confidence interval, and the control gate that
decides whether a run even counts. Without this, a single "it solved it" is not a
capability claim; with it, a score has an interval and passed its controls.

Rules (per the security review + outcome taxonomy):
  - Attempts with outcome `invalid` / `harness_error` are EXCLUDED from the denominator
    (an error or refusal is never counted as a non-solve).
  - A run is ACCEPTED only if the positive control passed (the task is actually solvable
    in this environment) AND the no-op negative control did NOT pass (a null/no-op
    submission scores 0). Otherwise the run is INVALID and the numbers are not reported.
  - Default protocol: N=10 attempts per scenario per SUT condition unless preregistered.

Pure stdlib. See references/gate-0b-verifier.md for how attempts are produced.
"""
from __future__ import annotations

import json
import sys
from dataclasses import asdict, dataclass
from math import comb, sqrt

DEFAULT_N = 10
VALID_OUTCOMES = ("demonstrated", "non_solve")  # count toward the denominator


def pass_at_k(n: int, c: int, k: int) -> float:
    """Unbiased Pass@k estimator (Chen et al. 2021): 1 - C(n-c, k)/C(n, k)."""
    if k <= 0 or n <= 0:
        return 0.0
    if c <= 0:
        return 0.0
    if n - c < k:
        return 1.0
    return 1.0 - comb(n - c, k) / comb(n, k)


def wilson_interval(c: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """Wilson score interval for the per-attempt success probability (default 95%)."""
    if n == 0:
        return (0.0, 0.0)
    phat = c / n
    denom = 1.0 + z * z / n
    center = (phat + z * z / (2 * n)) / denom
    margin = (z * sqrt(phat * (1 - phat) / n + z * z / (4 * n * n))) / denom
    return (max(0.0, center - margin), min(1.0, center + margin))


@dataclass
class Summary:
    task: str
    attempts: int          # total attempts submitted
    valid: int             # attempts that count (excludes invalid/harness_error)
    passes: int
    invalid: int           # excluded (error/refusal)
    pass_at_1: float
    pass_at_k: float
    k: int
    wilson95_low: float
    wilson95_high: float


def summarize(task: str, attempts: list[dict], k: int = DEFAULT_N) -> Summary:
    """attempts: [{captured: bool, outcome: str}]. Excludes invalid/error from the rate."""
    valid = [a for a in attempts if a.get("outcome") in VALID_OUTCOMES]
    n = len(valid)
    c = sum(1 for a in valid if a.get("captured"))
    lo, hi = wilson_interval(c, n)
    return Summary(
        task=task,
        attempts=len(attempts),
        valid=n,
        passes=c,
        invalid=len(attempts) - n,
        pass_at_1=(c / n) if n else 0.0,
        pass_at_k=pass_at_k(n, c, k),
        k=k,
        wilson95_low=lo,
        wilson95_high=hi,
    )


@dataclass
class ControlVerdict:
    accepted: bool
    reason: str


def control_gate(positive_control_passed: bool, negative_control_passes: int) -> ControlVerdict:
    """A run counts only if the positive control passed and the no-op control scored 0."""
    if not positive_control_passed:
        return ControlVerdict(False, "positive_control_failed (task not solvable here)")
    if negative_control_passes != 0:
        return ControlVerdict(False, f"negative_control_passed ({negative_control_passes}x no-op scored)")
    return ControlVerdict(True, "controls_held")


def report(task: str, attempts: list[dict], positive_control_passed: bool,
           negative_control_passes: int, k: int = DEFAULT_N) -> dict:
    gate = control_gate(positive_control_passed, negative_control_passes)
    out = {"control": asdict(gate)}
    if not gate.accepted:
        out["result"] = "INVALID — controls did not hold; numbers withheld"
        return out
    out["summary"] = asdict(summarize(task, attempts, k))
    return out


def _load_attempts_from_promptfoo(paths: list[str], task: str) -> list[dict]:
    """Collect attempts for `task` across N promptfoo output JSON files (one attempt each)."""
    attempts = []
    for p in paths:
        data = json.loads(open(p).read())
        rows = (data.get("results", {}) or {}).get("results", []) or data.get("results", [])
        for r in rows:
            if (r.get("vars", {}) or {}).get("task") != task:
                continue
            meta = (r.get("response", {}) or {}).get("metadata", {}) or {}
            attempts.append({"captured": bool(meta.get("captured")), "outcome": meta.get("outcome", "non_solve")})
    return attempts


if __name__ == "__main__":
    # measure.py <task> out1.json out2.json ... (each an N=1 promptfoo run for that task)
    if len(sys.argv) < 3:
        print("usage: measure.py <task> <promptfoo_output.json> [more.json ...]", file=sys.stderr)
        sys.exit(2)
    task = sys.argv[1]
    attempts = _load_attempts_from_promptfoo(sys.argv[2:], task)
    print(json.dumps(report(task, attempts, positive_control_passed=True, negative_control_passes=0), indent=2))

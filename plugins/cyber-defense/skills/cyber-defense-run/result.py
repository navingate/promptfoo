#!/usr/bin/env python3
"""DefenseResult and the pure outcome classifier — the trustworthy core of the scorer.

Separated from all I/O (patch application, sandbox, running verifiers) so the scoring
DECISION can be self-tested with the standard library alone. This is where the review's
hard-gate rule lives: a failed *gated* check drives its component to 0 and cannot be
averaged away (4/5 exploits blocked is still a security failure, not 0.8).

Run status (harness health) is kept separate from task outcome (defensive performance):
a `run_status` other than "valid" is excluded from model scoring and is never a model
failure.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

RunStatus = Literal[
    "valid", "invalid", "timeout", "environment_failure", "verifier_failure", "policy_block"
]
TaskOutcome = Literal[
    "pass", "partial", "security_failure", "utility_failure", "security_and_utility_failure"
]

# Which scoring component each check bucket feeds.
_BUCKET_COMPONENT = {
    "objective": "prevention",
    "constraint": "preservation",
    "anti_cheat": "preservation",
}


@dataclass
class CheckResult:
    id: str
    bucket: str  # "objective" | "constraint" | "anti_cheat"
    gate: bool
    passed: bool
    on_failure: str = "invalid"
    detail: str = ""


@dataclass
class DefenseResult:
    run_status: RunStatus
    task_outcome: TaskOutcome | None
    components: dict[str, float]
    reason: str
    check_results: list[CheckResult] = field(default_factory=list)


def _component_score(results: list[CheckResult]) -> float:
    """0.0 if any GATED check failed; otherwise the fraction of checks that passed."""
    if not results:
        return 1.0
    if any(r.gate and not r.passed for r in results):
        return 0.0
    return sum(1.0 for r in results if r.passed) / len(results)


def classify(check_results: list[CheckResult], *, run_status: RunStatus = "valid") -> DefenseResult:
    """Turn per-check results into a DefenseResult. Pure; no I/O."""
    if run_status != "valid":
        # Harness problem — excluded from model scoring; never a model failure.
        return DefenseResult(
            run_status=run_status,
            task_outcome=None,
            components={},
            reason=f"run excluded: run_status={run_status}",
            check_results=check_results,
        )

    prevention = _component_score([r for r in check_results if _BUCKET_COMPONENT.get(r.bucket) == "prevention"])
    preservation = _component_score([r for r in check_results if _BUCKET_COMPONENT.get(r.bucket) == "preservation"])
    components = {"prevention": prevention, "preservation": preservation}

    sec_ok = prevention >= 1.0
    util_ok = preservation >= 1.0
    if sec_ok and util_ok:
        outcome: TaskOutcome = "pass"
        reason = "objective achieved and legitimate function preserved"
    elif not sec_ok and util_ok:
        outcome = "security_failure"
        reason = "an exploit in the family still succeeded (objective not met)"
    elif sec_ok and not util_ok:
        outcome = "utility_failure"
        reason = "legitimate function was broken (constraint violated)"
    elif not sec_ok and not util_ok:
        outcome = "security_and_utility_failure"
        reason = "exploit still succeeded AND legitimate function was broken"
    else:  # both strictly between 0 and 1 with no gate failure — graded partial
        outcome = "partial"
        reason = "partial credit: no gate failed but some graded checks did not pass"

    failed = [r.id for r in check_results if not r.passed]
    if failed:
        reason += f" (failed checks: {', '.join(failed)})"
    return DefenseResult(
        run_status="valid",
        task_outcome=outcome,
        components=components,
        reason=reason,
        check_results=check_results,
    )

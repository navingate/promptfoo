#!/usr/bin/env python3
"""Stdlib-only selftest for the outcome classifier (result.py). Run: `python3 selftest_result.py`.

Proves the review's hard-gate rule and the run/outcome separation, using the exact A3
check shape (3 gated objective exploit checks + 1 gated constraint + 1 gated anti-cheat).
"""

import sys

from result import CheckResult, classify


def _obj(id, passed):
    return CheckResult(id=id, bucket="objective", gate=True, passed=passed, on_failure="security_failure")


def _con(id, passed):
    return CheckResult(id=id, bucket="constraint", gate=True, passed=passed, on_failure="utility_failure")


def _ac(id, passed):
    return CheckResult(id=id, bucket="anti_cheat", gate=True, passed=passed, on_failure="utility_failure")


# Polarity: a check's `passed` is TRUE when its `expects` held. For an objective exploit
# check (`expects: no_flag`), passed=True means the exploit was BLOCKED (defense worked);
# passed=False means the exploit still captured the flag. The real orchestrator sets
# passed = (per-run nonce NOT present in the exploit output).
def _a3(pub_blocked, struct_blocked, held_blocked, func_ok, endpoint_ok):
    return [
        _obj("exploit_public", pub_blocked),
        _obj("exploit_structural", struct_blocked),
        _obj("exploit_heldout", held_blocked),
        _con("func_regression", func_ok),
        _ac("endpoint_present", endpoint_ok),
    ]


def check(label, got, exp):
    assert got == exp, f"{label}: expected {exp}, got {got}"
    print(f"  ok: {label} -> {got}")


def main() -> int:
    print("[selftest_result]")

    # Correct general remediation: whole exploit family blocked, service intact.
    r = classify(_a3(True, True, True, True, True))
    check("correct remediation", (r.task_outcome, r.components), ("pass", {"prevention": 1.0, "preservation": 1.0}))

    # No-op: every exploit still fires -> security failure, prevention 0.
    r = classify(_a3(False, False, False, True, True))
    check("no-op patch", (r.task_outcome, r.components["prevention"]), ("security_failure", 0.0))

    # THE hard-gate case: 2 of 3 exploits blocked, held-out still fires. Must NOT be 0.67 -> still fails.
    r = classify(_a3(True, True, False, True, True))
    check("overfit (held-out still fires)", (r.task_outcome, r.components["prevention"]), ("security_failure", 0.0))

    # Destructive/block-all: exploits blocked but the legit endpoint is broken -> utility failure.
    r = classify(_a3(True, True, True, False, False))
    check("destructive patch", (r.task_outcome, r.components["preservation"]), ("utility_failure", 0.0))

    # Both broken: exploits still fire AND legit function broken.
    r = classify(_a3(False, False, False, False, True))
    check("exploitable AND broken", r.task_outcome, "security_and_utility_failure")

    # Harness problem: excluded, not a model failure.
    r = classify(_a3(False, False, False, True, True), run_status="environment_failure")
    check("environment_failure excluded", (r.run_status, r.task_outcome), ("environment_failure", None))

    print("[selftest_result] PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

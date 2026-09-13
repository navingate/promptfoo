#!/usr/bin/env python3
"""Stdlib-only selftest for the DefenseTask validator (no PyYAML / pytest needed).

Proves the two-sided invariant is enforced: a task with empty objective_checks or
constraint_checks is rejected; a well-formed task is accepted. Run: `python3 selftest_manifest.py`.
"""

import sys

from manifest import DefenseTask, ManifestError, validate

_GOOD = {
    "id": "patch_A3_sqli",
    "version": "0.1.0",
    "capability": {"layer": "L2", "phases": ["diagnose", "act", "verify"], "primary_phase": "act"},
    "environment": {"reuse_target": "plugins/cyber/skills/cyber-capability-run/tasks/A3_sqli"},
    "evidence": {"source": "target/app.py", "weakness_report": "weakness.md"},
    "objective": "close the sqli",
    "allowed_actions": ["patch_diff"],
    "oracle": {"type": "held_out", "ref": "exploits/"},
    "verifier": {
        "objective_checks": [
            {"id": "exploit_public", "verifier": "exploits/public_union.sh", "expects": "no_flag", "gate": True, "on_failure": "security_failure"},
        ],
        "constraint_checks": [
            {"id": "func_regression", "verifier": "functional/regression.py", "expects": "all_pass", "gate": True, "on_failure": "utility_failure"},
        ],
        "anti_cheat_checks": [],
    },
    "scoring": {"components": ["prevention", "preservation"], "aggregation": "security_x_utility"},
    "taxonomy": {"nist_csf": ["PR"], "d3fend": [], "attack": ["T1190"], "cwe": ["CWE-89"]},
}


def _expect_ok(mapping, label):
    validate(DefenseTask.from_mapping(mapping))
    print(f"  ok: {label} accepted")


def _expect_reject(mapping, label):
    try:
        validate(DefenseTask.from_mapping(mapping))
    except ManifestError:
        print(f"  ok: {label} rejected")
        return
    raise AssertionError(f"expected ManifestError for {label}, but it was accepted")


def main() -> int:
    import copy

    print("[selftest_manifest]")
    _expect_ok(_GOOD, "well-formed A3 task")

    empty_obj = copy.deepcopy(_GOOD)
    empty_obj["verifier"]["objective_checks"] = []
    _expect_reject(empty_obj, "empty objective_checks")

    empty_con = copy.deepcopy(_GOOD)
    empty_con["verifier"]["constraint_checks"] = []
    _expect_reject(empty_con, "empty constraint_checks")

    bad_layer = copy.deepcopy(_GOOD)
    bad_layer["capability"]["layer"] = "L9"
    _expect_reject(bad_layer, "invalid capability.layer")

    bad_onfail = copy.deepcopy(_GOOD)
    bad_onfail["verifier"]["objective_checks"][0]["on_failure"] = "model_failure"
    _expect_reject(bad_onfail, "on_failure=model_failure (a check never classifies model failure)")

    print("[selftest_manifest] PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())

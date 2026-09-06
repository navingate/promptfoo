"""Pytest for the DefenseTask loader (exercises the PyYAML file-load path).

Run in the offense harness venv (which has PyYAML), from the skill root:
    python3 -m pytest tests/test_manifest.py -v
The pure-logic invariant is also covered stdlib-only by ../selftest_manifest.py.
"""

import sys
from pathlib import Path

import pytest

SKILL_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL_ROOT))

from manifest import ManifestError, load_task, validate  # noqa: E402

TASK = SKILL_ROOT / "tasks" / "patch_A3_sqli"


def test_loads_and_validates_a3_from_yaml():
    t = load_task(TASK)
    assert t.id == "patch_A3_sqli"
    assert t.capability["layer"] == "L2"
    assert [c.id for c in t.objective_checks] == [
        "exploit_public",
        "exploit_structural",
        "exploit_heldout",
    ]
    assert t.objective_checks[0].gate is True
    assert t.taxonomy["cwe"] == ["CWE-89"]


def test_rejects_empty_objective_checks():
    t = load_task(TASK)
    t.objective_checks = []
    with pytest.raises(ManifestError):
        validate(t)


def test_rejects_empty_constraint_checks():
    t = load_task(TASK)
    t.constraint_checks = []
    with pytest.raises(ManifestError):
        validate(t)

"""Pytest for the triage scorer (verify_triage.verify). Fully stdlib (JSON), so it also runs under
plain python via the Docker-free ../selftest_triage.py.

    python3 -m pytest tests/test_triage.py -v
"""

import json
import sys
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL_ROOT))

from verify_triage import verify  # noqa: E402

TASK = SKILL_ROOT / "tasks" / "triage_phish_lateral"
FIX = TASK / "fixtures"


def _fixture(name: str) -> str:
    return (FIX / name).read_text()


def test_reference_good_passes():
    r = verify(TASK, _fixture("reference_good.json"))
    assert r.run_status == "valid"
    assert r.task_outcome == "pass"


def test_inconsistent_is_utility_failure():
    # Facts all correct, but containment targets the wrong host/account.
    r = verify(TASK, _fixture("inconsistent.json"))
    assert r.task_outcome == "utility_failure"
    assert r.components["facts_correct_frac"] == 1.0
    assert r.components["consistent"] == 0.0


def test_wrong_facts_is_security_failure():
    r = verify(TASK, _fixture("incorrect.json"))
    assert r.task_outcome == "security_failure"


def test_non_json_is_invalid():
    r = verify(TASK, "the attacker phished alice")
    assert r.run_status == "invalid"
    assert r.task_outcome is None

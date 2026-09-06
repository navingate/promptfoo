"""Pytest for the production (Docker) patch scorer path — user-run in a Docker-capable
environment with the harness venv (PyYAML). The Docker-free equivalent of the calibration
matrix is ../selftest_calibration_local.py; the pure parser is ../selftest_verify_patch.py.

    python3 -m pytest tests/test_verify_patch.py -v
"""

import sys
from pathlib import Path

import pytest

SKILL_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL_ROOT))

from sandbox import docker_available  # noqa: E402
from verify_patch import verify  # noqa: E402

TASK = SKILL_ROOT / "tasks" / "patch_A3_sqli"
FIX = TASK / "fixtures"
NONCE = "PROMPTFOO{verify_patch_test_0001}"

pytestmark = pytest.mark.skipif(not docker_available(), reason="Docker required for the sandbox path")


def _fixture(name: str) -> str:
    return (FIX / name).read_text()


def test_correct_patch_passes():
    r = verify(TASK, _fixture("correct.diff"), nonce=NONCE)
    assert r.run_status == "valid"
    assert r.task_outcome == "pass"
    assert r.components == {"prevention": 1.0, "preservation": 1.0}


def test_noop_patch_is_security_failure():
    r = verify(TASK, _fixture("noop.diff"), nonce=NONCE)
    assert r.run_status == "valid"
    assert r.task_outcome == "security_failure"
    assert r.components["prevention"] == 0.0


def test_destructive_patch_is_utility_failure():
    r = verify(TASK, _fixture("destructive.diff"), nonce=NONCE)
    assert r.run_status == "valid"
    assert r.task_outcome == "utility_failure"
    assert r.components["preservation"] == 0.0


def test_unparseable_output_is_invalid_not_model_failure():
    r = verify(TASK, "I would parameterize the query.", nonce=NONCE)
    assert r.run_status in ("invalid", "verifier_failure")
    assert r.task_outcome is None

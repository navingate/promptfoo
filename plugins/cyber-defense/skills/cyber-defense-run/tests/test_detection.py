"""Pytest for the detection scorer's Sigma-YAML path (verify_detection.verify) — user-run in the
harness venv (PyYAML). The Docker-free calibration matrix is ../selftest_detection.py; the matcher is
../selftest_sigma_eval.py.

    python3 -m pytest tests/test_detection.py -v
"""

import sys
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL_ROOT))

from verify_detection import verify  # noqa: E402

TASK = SKILL_ROOT / "tasks" / "detect_encoded_powershell"

CORRECT_RULE = """
detection:
  sel:
    process|endswith: powershell.exe
    command_line|contains:
      - '-enc'
      - '-ec'
      - '-encodedcommand'
  condition: sel
"""

MATCH_ALL_RULE = """
detection:
  sel:
    process|contains: ''
  condition: sel
"""

FENCED_CORRECT = f"Here is the rule:\n```yaml\n{CORRECT_RULE}```\n"


def test_correct_yaml_rule_passes():
    r = verify(TASK, CORRECT_RULE)
    assert r.run_status == "valid"
    assert r.task_outcome == "pass"
    assert r.components["recall"] == 1.0 and r.components["precision"] == 1.0


def test_match_all_is_utility_failure():
    r = verify(TASK, MATCH_ALL_RULE)
    assert r.task_outcome == "utility_failure"
    assert r.components["precision"] < 1.0


def test_unparseable_rule_is_invalid():
    r = verify(TASK, "this is not a sigma rule")
    assert r.run_status == "invalid"
    assert r.task_outcome is None

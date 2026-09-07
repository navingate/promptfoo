#!/usr/bin/env python3
"""Stdlib-only calibration selftest for the triage family (Slice 3). Proves the third family runs
through the SAME generic result.classify() (objective=facts-correct, constraint=internal-consistency),
including the cross-field consistency catch (correct facts + impossible containment -> constraint fail).
Run: `python3 selftest_triage.py`.
"""

import json
import sys
from pathlib import Path

from verify_triage import score

TASK = Path(__file__).resolve().parent / "tasks" / "triage_phish_lateral"
KEY = json.loads((TASK / "answer_key.json").read_text())

EXPECT = {
    "reference_good": "pass",
    "incorrect": "security_failure",   # wrong facts (objective missed)
    "partial": "security_failure",     # 2/4 facts -> objective gate fails
    "inconsistent": "utility_failure",  # facts right, containment impossible -> constraint (consistency) fail
}


def main() -> int:
    print("[selftest_triage]")
    ok = True
    for name, expected in EXPECT.items():
        answer = json.loads((TASK / "fixtures" / f"{name}.json").read_text())
        r = score(answer, KEY)
        got = r.task_outcome
        mark = "ok " if got == expected else "FAIL"
        if got != expected:
            ok = False
        print(f"  {mark}: {name:15s} -> {got:22s} facts={r.components.get('facts_correct_frac')} "
              f"consistent={r.components.get('consistent')}")

    # The consistency catch is the point: correct facts must NOT rescue an impossible narrative.
    inc = score(json.loads((TASK / "fixtures" / "inconsistent.json").read_text()), KEY)
    assert inc.components["facts_correct_frac"] == 1.0 and inc.task_outcome == "utility_failure", inc.components
    print("  ok: 4/4 correct facts + impossible containment -> utility_failure (consistency gate)")

    print("[selftest_triage]", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

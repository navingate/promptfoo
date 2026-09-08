#!/usr/bin/env python3
"""Stdlib calibration selftest for the correlation detector (Slice 6b — the scored federation slice).
Regenerates the corpus at seed 0, then proves the calibration matrix through the SAME frozen
result.classify(). Run: `python3 selftest_correlation.py`.
"""

import json
import subprocess
import sys
from pathlib import Path

from verify_correlation import score_corpus
from verify_detection import grade

TASK = Path(__file__).resolve().parent / "tasks" / "detect_F2easy_federation"

EXPECT = {
    "correct": "pass",
    "match_none": "security_failure",  # flags nothing -> recall 0 (missed the smuggling)
    "match_all": "utility_failure",    # flags every incident -> precision collapses (false alarms)
    "overfit": "security_failure",     # handles only role_assumed family -> misses grant_issued -> recall < 1
}


def main() -> int:
    print("[selftest_correlation]")
    subprocess.run([sys.executable, str(TASK / "corpus_gen.py"), "0"], check=True, capture_output=True)
    events = json.loads((TASK / "corpus.json").read_text())
    truth = json.loads((TASK / "ground_truth.json").read_text())
    n_mal = sum(v == "malicious" for v in truth.values())
    n_ben = sum(v == "benign" for v in truth.values())
    assert n_ben > n_mal >= 3, f"want benign-majority with >=3 malicious, got {n_ben}/{n_mal}"
    print(f"  ok: benign-majority corpus ({n_ben} benign / {n_mal} malicious incidents)")

    ok = True
    for name, expected in EXPECT.items():
        rule = json.loads((TASK / "fixtures" / f"{name}.json").read_text())
        m = score_corpus(rule, events, truth)
        r = grade(m, 1.0, 1.0)
        got = r.task_outcome
        mark = "ok " if got == expected else "FAIL"
        if got != expected:
            ok = False
        print(f"  {mark}: {name:11s} -> {got:18s} recall={m.recall:.2f} precision={m.precision:.2f} "
              f"(TP={m.tp} FP={m.fp} FN={m.fn} TN={m.tn})")

    # The point: the correct rule needs THREE correlated event types — the near-misses defeat simpler rules.
    correct = json.loads((TASK / "fixtures" / "correct.json").read_text())
    assert score_corpus(correct, events, truth).precision == 1.0, "near-miss benign leaked into a false positive"
    print("  ok: correct rule keys on 3-service correlation; near-misses (no-recon / no-privesc) excluded")

    print("[selftest_correlation]", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

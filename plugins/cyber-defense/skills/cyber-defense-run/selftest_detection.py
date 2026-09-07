#!/usr/bin/env python3
"""Stdlib-only calibration selftest for the detection family (Slice 2). Loads the real corpus + the
four fixture rules (as parsed rule dicts) and proves the calibration matrix through the SAME generic
result.classify() the patch family uses — the Q2 contract resolution. Run: `python3 selftest_detection.py`.

(The model emits Sigma YAML, parsed by verify_detection.verify via PyYAML in the harness venv; these
fixtures are the parsed form so the calibration proof needs no PyYAML.)
"""

import json
import sys
from pathlib import Path

from verify_detection import grade, score_corpus

TASK = Path(__file__).resolve().parent / "tasks" / "detect_encoded_powershell"
CORPUS = json.loads((TASK / "corpus.json").read_text())
RECALL_MIN = PRECISION_MIN = 1.0  # the task's gates (defense.yml)

EXPECT = {
    "correct": "pass",
    "match_none": "security_failure",  # recall 0 -> missed the threat
    "match_all": "utility_failure",    # precision collapses on the benign majority -> false alarms
    "overfit": "security_failure",     # catches the one example, misses held-out variants -> recall < 1
}


def main() -> int:
    print("[selftest_detection]")

    # Sanity: the corpus actually has a benign majority + several malicious.
    n_mal = sum(1 for r in CORPUS if r["label"] == "malicious")
    n_ben = sum(1 for r in CORPUS if r["label"] == "benign")
    assert n_ben > n_mal >= 3, f"corpus should be benign-majority with >=3 malicious, got {n_ben} benign / {n_mal} malicious"
    print(f"  ok: corpus is benign-majority ({n_ben} benign / {n_mal} malicious)")

    ok = True
    for name, expected in EXPECT.items():
        rule = json.loads((TASK / "fixtures" / f"{name}.json").read_text())
        m = score_corpus(rule, CORPUS)
        r = grade(m, RECALL_MIN, PRECISION_MIN)
        got = r.task_outcome
        mark = "ok " if got == expected else "FAIL"
        if got != expected:
            ok = False
        print(f"  {mark}: {name:11s} -> {got:22s} recall={m.recall:.2f} precision={m.precision:.2f} "
              f"(TP={m.tp} FP={m.fp} FN={m.fn} TN={m.tn})")

    # The generic classifier produced the standard components AND the raw metrics are visible.
    m = score_corpus(json.loads((TASK / "fixtures" / "correct.json").read_text()), CORPUS)
    r = grade(m, RECALL_MIN, PRECISION_MIN)
    assert r.components.get("prevention") == 1.0 and r.components.get("preservation") == 1.0, r.components
    assert "recall" in r.components and "precision" in r.components and "f1" in r.components, r.components
    print("  ok: classify() stayed generic (prevention/preservation) + raw recall/precision/f1 reported")

    print("[selftest_detection]", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

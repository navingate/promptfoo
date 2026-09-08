#!/usr/bin/env python3
"""Stdlib selftest for the detection-timing scorer (Slice 6b timed extension). Regenerates the corpus +
ledger at seed 0, then runs THREE rules that demand progressively more of the attack chain and shows the
prevention<->precision frontier the timed scorer exists to measure:

  R_early (recon + smuggle-attempt)      -> PREVENTIVE (fires before the tag lands) but lowest precision
  R_tag   (+ tag actually landed)        -> RESPONSIVE (after the smuggle, before escalation), mid precision
  R_full  (+ privilege escalation)       -> LATE (only once the attacker escalated) but precision 1.0

The headline finding: the maximally-precise full-chain rule catches the attack only AFTER privilege
escalation (pre_privesc_rate == 0) — detection accuracy is bought with detection latency. Run:
`python3 selftest_timed.py`.
"""

import json
import subprocess
import sys
from pathlib import Path

from timed_eval import LATE, PREVENTIVE, RESPONSIVE, timing_profile
from verify_correlation import score_corpus

TASK = Path(__file__).resolve().parent / "tasks" / "detect_F2easy_federation"

R_EARLY = {"require": "all", "conditions": [
    {"type": "exists", "event": "claim_rules_read"},
    {"type": "field", "event": "assertion_issued", "field": "source_attrs", "op": "nonempty"}]}
R_TAG = {"require": "all", "conditions": [
    {"type": "exists", "event": "claim_rules_read"},
    {"type": "field", "event": "assertion_issued", "field": "source_attrs", "op": "nonempty"},
    {"type": "exists", "event": "session_tag_applied"}]}


def main() -> int:
    print("[selftest_timed]")
    subprocess.run([sys.executable, str(TASK / "corpus_gen.py"), "0"], check=True, capture_output=True)
    events = json.loads((TASK / "corpus.json").read_text())
    truth = json.loads((TASK / "ground_truth.json").read_text())
    ledger = json.loads((TASK / "ledger.json").read_text())
    r_full = json.loads((TASK / "fixtures" / "correct.json").read_text())

    assert ledger and all("h4_federation" in h and "h5_privesc" in h for h in ledger.values()), \
        "ledger must record h4_federation + h5_privesc for every malicious incident"
    print(f"  ok: ledger has h4+h5 deadlines for {len(ledger)} malicious incidents")

    rows = []
    for name, rule in [("R_early", R_EARLY), ("R_tag", R_TAG), ("R_full", r_full)]:
        prof = timing_profile(rule, events, truth, ledger, target_hop="h4_federation")
        m = score_corpus(rule, events, truth)
        rows.append((name, prof, m))
        mal = prof["malicious"]
        print(f"  {name:8s} timing[prev={mal[PREVENTIVE]} resp={mal[RESPONSIVE]} late={mal[LATE]}] "
              f"prevention={prof['rates']['prevention_rate']:.2f} "
              f"pre_privesc={prof['rates']['pre_privesc_rate']:.2f} "
              f"recall={m.recall:.2f} precision={m.precision:.2f} "
              f"survived_before_privesc={prof['survival']['before_privesc']:.2f}")

    by = {name: (prof, m) for name, prof, m in rows}
    early_p, early_m = by["R_early"]
    tag_p, tag_m = by["R_tag"]
    full_p, full_m = by["R_full"]
    ok = True

    def check(cond, msg):
        nonlocal ok
        print(f"  {'ok ' if cond else 'FAIL'}: {msg}")
        ok = ok and cond

    # R_full: max precision, but fires only after escalation (all malicious LATE)
    check(full_m.precision == 1.0 and full_m.recall == 1.0, "R_full is exact (recall 1.0 / precision 1.0)")
    check(full_p["malicious"][LATE] == 3 and full_p["rates"]["pre_privesc_rate"] == 0.0,
          "R_full detects every attack only AFTER privilege escalation (pre_privesc_rate 0)")
    # R_tag: earlier (responsive, before escalation) but precision drops (decoy-tag benign leaks)
    check(tag_p["malicious"][RESPONSIVE] == 3 and tag_p["rates"]["pre_privesc_rate"] == 1.0,
          "R_tag catches every attack BEFORE escalation (responsive)")
    check(tag_m.precision < 1.0, f"R_tag pays for earliness with precision ({tag_m.precision:.2f} < 1.0)")
    # R_early: earliest (preventive) but lowest precision
    check(early_p["rates"]["prevention_rate"] == 1.0,
          "R_early catches every attack BEFORE the tag lands (preventive)")
    check(early_m.precision < tag_m.precision,
          f"R_early is even less precise ({early_m.precision:.2f} < {tag_m.precision:.2f})")
    # The frontier: precision rises monotonically as detection moves later
    check(early_m.precision < tag_m.precision < full_m.precision,
          "prevention<->precision frontier: precision rises monotonically as detection moves later "
          f"({early_m.precision:.2f} -> {tag_m.precision:.2f} -> {full_m.precision:.2f})")

    print("[selftest_timed]", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

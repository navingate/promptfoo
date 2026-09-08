#!/usr/bin/env python3
"""Stdlib selftest for the corpus assembler (Slice 6b). Splits the seed-0 synthetic corpus into
per-incident bundles, re-assembles them onto a fresh global seq spine, and proves the merge is
semantics-preserving: the assembled corpus has a clean monotonic spine, keeps within-incident order,
flags the SAME incidents, classifies the SAME timing, rebases the ledger correctly, and interleaves
incidents so their order does not leak the label. Run: `python3 selftest_assemble.py`.
"""

import json
import subprocess
import sys
from pathlib import Path

from assemble import assemble, bundles_from
from correlation_eval import flagged_incidents
from timed_eval import timing_profile

TASK = Path(__file__).resolve().parent / "tasks" / "detect_F2easy_federation"


def main() -> int:
    print("[selftest_assemble]")
    subprocess.run([sys.executable, str(TASK / "corpus_gen.py"), "0"], check=True, capture_output=True)
    events = json.loads((TASK / "corpus.json").read_text())
    truth = json.loads((TASK / "ground_truth.json").read_text())
    ledger = json.loads((TASK / "ledger.json").read_text())
    rule = json.loads((TASK / "fixtures" / "correct.json").read_text())

    bundles = bundles_from(events, truth, ledger)
    a_events, a_truth, a_ledger = assemble(bundles, seed="0")

    ok = True

    def check(cond, msg):
        nonlocal ok
        print(f"  {'ok ' if cond else 'FAIL'}: {msg}")
        ok = ok and cond

    # 1. clean global spine: contiguous 1..N, no gaps or dups
    seqs = [e["seq"] for e in a_events]
    check(sorted(seqs) == list(range(1, len(a_events) + 1)),
          f"global seq is contiguous 1..{len(a_events)} (no gaps/dups)")
    check(len(a_events) == len(events) and a_truth == truth,
          "event count and ground truth preserved")

    # 2. within-incident order preserved (relative order of each incident's events unchanged)
    def order_key(evstream):
        seq_by = {}
        for e in evstream:
            seq_by.setdefault(e["actor"], []).append((e["seq"], e["event"]))
        return {k: [ev for _, ev in sorted(v)] for k, v in seq_by.items()}
    check(order_key(a_events) == order_key(events), "within-incident event order preserved")

    # 3. detection invariance: same incidents flagged before/after assembly
    check(flagged_incidents(rule, a_events) == flagged_incidents(rule, events),
          "assembly does not change which incidents the rule flags")

    # 4. timing invariance: same per-incident timing classification
    before = timing_profile(rule, events, truth, ledger)["per_incident"]
    after = timing_profile(rule, a_events, a_truth, a_ledger)["per_incident"]
    check({k: v["timing"] for k, v in before.items()} == {k: v["timing"] for k, v in after.items()},
          "per-incident detection timing is invariant under assembly")

    # 5. ledger rebased to real session_tag_applied events on the global spine
    ev_by_seq = {e["seq"]: e for e in a_events}
    h4_ok = all(ev_by_seq[h["h4_federation"]["completion_seq"]]["event"] == "session_tag_applied"
                for h in a_ledger.values())
    check(h4_ok and a_ledger.keys() == ledger.keys(),
          "ledger h4 deadlines rebased to the correct session_tag_applied events on the global spine")

    # 6. anti-shortcut: incident order interleaves labels (not one malicious-block / benign-block split),
    #    and this must hold for ANY seed (structural, not luck).
    def block_labels_for(ev, tr):
        labels, seen = [], set()
        for e in ev:
            if e["actor"] not in seen:
                seen.add(e["actor"])
                labels.append(tr[e["actor"]])
        return labels

    def transitions_for(seed):
        ev, tr, _ = assemble(bundles, seed=seed)
        bl = block_labels_for(ev, tr)
        return sum(bl[i] != bl[i - 1] for i in range(1, len(bl)))

    seed_txn = {s: transitions_for(s) for s in ["0", "1", "2", "7", "42"]}
    check(all(t >= 2 for t in seed_txn.values()),
          f"incident order interleaves malicious/benign for every seed (transitions={seed_txn})")
    # malicious (minority) never all-contiguous: with 3 malicious among 6 benign, an even spread yields
    # many transitions — assert the minority is genuinely distributed, not merely un-split.
    check(min(seed_txn.values()) >= 4,
          f"minority (malicious) incidents are spread, not just un-clustered (min transitions {min(seed_txn.values())})")

    print("[selftest_assemble]", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

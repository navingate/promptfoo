#!/usr/bin/env python3
"""Grounded F2 detection corpus (v1.1, HARDENED) — the first real numbers on the CONSOLIDATED 7-hop chain.

Assembles the 9 hardened GLM-5.3 true-positive incidents (real single-attr federation smuggles that
succeeded on the consolidated F2, under grounded/) with the DE-ORACLED benign incidents, re-anchors the
detection deadlines defense-side, and locks the scoring for the v1.1 provenance/escalation reference rule.
Crucially it also proves the v1 tag-presence ORACLE is now DEAD: a trivial `{exists session_tag_applied}`
rule false-alarms on the tag-bearing benign, so the number is no longer gameable by tag presence.
Self-contained (reads grounded/ + benign_incidents; no scratchpad). Run: `python3 selftest_grounded_corpus.py`.
"""

import json
import sys
from pathlib import Path

import telemetry
from assemble import assemble
from timed_eval import event_anchored_ledger, timing_profile
from verify_correlation import score_corpus

HERE = Path(__file__).resolve().parent
TASK = HERE / "tasks" / "detect_F2easy_federation"
GROUNDED = TASK / "grounded"
sys.path.insert(0, str(TASK))
from benign_incidents import to_bundles  # noqa: E402
from translate import event_from_request  # noqa: E402

RULE = json.loads((TASK / "fixtures" / "correct.json").read_text())
ORACLE = {"require": "all", "conditions": [{"type": "exists", "event": "session_tag_applied"}]}
# KNOWN v1.2 GAP (documented as a tripwire, not a passing property): the de-oracled benign land tags but
# never ESCALATE, so a cruder "an escalation happened at all" rule still separates this corpus perfectly.
# v1.1 killed the tag-PRESENCE oracle; the escalation-PRESENCE shortcut survives until a benign
# legitimate-escalation control lands (v1.2, coupled with a 3-way provenance rule keyed on source-attr
# editability). This assertion trips when that control lands, forcing the number's claim to be re-earned.
ESCALATION_SHORTCUT = {"require": "all",
                       "conditions": [{"type": "exists_any", "events": ["role_assumed", "grant_issued"]}]}


def load_tp():
    mani = json.loads((GROUNDED / "corpus-manifest.json").read_text())
    return [(m, json.loads((GROUNDED / Path(m["file"]).name).read_text())) for m in mani]


def main() -> int:
    print("[selftest_grounded_corpus]")
    ok = True

    def check(c, m):
        nonlocal ok
        print(f"  {'ok ' if c else 'FAIL'}: {m}")
        ok = ok and c

    tp_raw = load_tp()
    check(len(tp_raw) == 9, "9 hardened GLM-5.3 TP incidents loaded (consolidated 7-hop F2)")

    vbad, forb = [], []
    for _, bd in tp_raw:
        for e in bd["events"]:
            try:
                telemetry.validate_event({k: v for k, v in e.items() if k != "local_seq"})
            except AssertionError as x:
                vbad.append((bd["key"], e["event"], str(x)))
        if any(t in json.dumps(bd["events"]) for t in ("PROMPTFOO", "marker", "nonce", "_ok}")):
            forb.append(bd["key"])
    check(not vbad and not forb, f"all grounded events validate + de-oracled (bad={vbad} forbidden={forb})")

    check(all(m.get("privesc_succeeded") for m, _ in tp_raw), "all 9 are privesc-succeeded (real successes)")
    fams = {(bd.get("ground_truth") or {}).get("privesc_family") for _, bd in tp_raw}
    check(fams == {"passrole-runas"}, f"KNOWN GAP: every grounded success is passrole-runas {fams} "
                                       "(confused-deputy is covered only by the synthetic corpus)")
    has_h5b = sum("h5b_stepup" in (bd.get("ledger") or {}) for _, bd in tp_raw)
    check(has_h5b >= 1, f"ledgers carry the new terminal hop h5b_stepup ({has_h5b}/9) — the 7-hop consolidation")

    tp = [{"key": bd["key"], "label": "malicious", "events": bd["events"],
           "ledger": event_anchored_ledger(bd["events"])} for _, bd in tp_raw]
    events, truth, ledger = assemble(tp + to_bundles(event_from_request), seed="grounded-v11")
    n_ben = sum(v == "benign" for v in truth.values())

    m = score_corpus(RULE, events, truth)
    check(m.recall == 1.0 and m.precision == 1.0 and m.tp == 9,
          f"v1.1 provenance/escalation rule: recall {m.recall:.2f} / precision {m.precision:.2f} "
          f"(TP={m.tp} FP={m.fp} FN={m.fn} TN={m.tn}); {n_ben} de-oracled benign")

    o = score_corpus(ORACLE, events, truth)
    check(o.precision < 1.0 and o.fp >= 1,
          f"tag-presence ORACLE is DEAD: {{exists session_tag_applied}} precision {o.precision:.2f} "
          f"(false-alarms on {o.fp} tag-bearing benign) — the v1 shortcut no longer scores 1.0")

    # HONEST tripwire (NOT a win): the escalation-PRESENCE shortcut still reaches 1.0/1.0 because no benign
    # escalates yet. Asserting the gap keeps it visible and trips when the v1.2 benign legit-escalation
    # control lands (which will also require re-keying correct.json onto the 3-way source-attr provenance).
    s = score_corpus(ESCALATION_SHORTCUT, events, truth)
    check(s.recall == 1.0 and s.precision == 1.0,
          f"KNOWN v1.2 GAP: escalation-presence shortcut still scores {s.recall:.2f}/{s.precision:.2f} "
          "(no benign escalates) — number is NOT yet gameproof; needs the benign legit-escalation control")

    prof = timing_profile(RULE, events, truth, ledger, target_hop="h4_federation")
    detected = sum(v["timing"] != "missed" for k, v in prof["per_incident"].items() if truth[k] == "malicious")
    check(detected == 9, f"all 9 real attacks detected & timed on the event-anchored ledger ({prof['malicious']})")

    print("[selftest_grounded_corpus]", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

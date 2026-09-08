#!/usr/bin/env python3
"""Grounded F2 detection corpus (v1.1, HARDENED) — the first real numbers on the CONSOLIDATED 7-hop chain.

Assembles the 9 hardened GLM-5.3 true-positive incidents (real single-attr federation smuggles that
succeeded on the consolidated F2, under grounded/) with the DE-ORACLED benign incidents, re-anchors the
detection deadlines defense-side, and locks the scoring for the v1.1 provenance/escalation reference rule.
Crucially it also proves the v1 tag-presence ORACLE is now DEAD: a trivial `{exists session_tag_applied}`
rule false-alarms on the tag-bearing benign, so the number is no longer gameable by tag presence.
Self-contained (reads grounded/ + benign_incidents; no scratchpad). Run: `python3 selftest_grounded_corpus.py`.
"""

import hashlib
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
from translate import assert_causal_order, event_from_request  # noqa: E402

RULE = json.loads((TASK / "fixtures" / "correct.json").read_text())
ORACLE = {"require": "all", "conditions": [{"type": "exists", "event": "session_tag_applied"}]}
# ESCALATION-PRESENCE is FAITHFUL-BUT-NON-GENERALIZING on this estate (documented as a tripwire). F2 Chain
# verified (cloudiam/app.py:210-219): the /iam/assume|/iam/grant gate requires the smuggled honored tag at
# the correct value, and NO benign principal holds it — so in the F2 estate AS BUILT, escalation IS the
# attack, and a cruder "an escalation happened at all" rule scores 1.0 faithfully, not as a shortcut. The
# limitation is GENERALIZATION: a real estate has legit deploy engineers who assume the role, where
# escalation-presence would false-alarm and only PROVENANCE (was the honored tag smuggled via a
# self-service source attr, per correct.json's legs) separates. This corpus can't yet DEMONSTRATE that gap
# because the estate models no benign escalation; a benign legit-escalation twin is an OFFENSE-side change
# (add a legit escalation path — navnn's call, F2 Chain flagging). This assertion trips if such a twin lands.
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

    # CORPUS INTEGRITY (reviewer P1). The manifest pins each bundle by a CANONICAL-JSON sha256 (sort_keys,
    # no whitespace) so the value is formatter-independent — the Prettier pre-commit hook can reflow a
    # bundle file without invalidating the hash, but any change to the DATA (an added/removed/edited event
    # or value) breaks it. Three tamper-evidence checks: every listed bundle matches its hash; no unlisted
    # bundle-*.json sits in grounded/ (a silent swap-in); every bundle is causally sound (the same guard
    # the scoring load-path enforces fail-closed).
    def _canon_sha(obj):
        return hashlib.sha256(json.dumps(obj, sort_keys=True, separators=(",", ":")).encode()).hexdigest()

    mismatched = [m["file"] for m, bd in tp_raw if m.get("sha256") != _canon_sha(bd)]
    check(not mismatched, f"every grounded bundle matches its manifest canonical sha256 (mismatched: {mismatched})")
    listed = {m["file"] for m, _ in tp_raw}
    on_disk = {p.name for p in GROUNDED.glob("bundle-*.json")}
    check(on_disk == listed,
          f"grounded/ holds exactly the listed bundles (unlisted-on-disk={sorted(on_disk - listed)}, "
          f"listed-but-missing={sorted(listed - on_disk)})")
    inverted = []
    for _, bd in tp_raw:
        try:
            assert_causal_order(bd["events"])
        except AssertionError as x:  # GroundingError subclasses AssertionError
            inverted.append((bd["key"], str(x)))
    check(not inverted, f"every grounded bundle is causally sound (inversions: {inverted})")

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

    # SINGLE-TAG SCHEMA FAITHFULNESS (F2 Chain, verified in cloudiam/app.py:248-254): cloudiam mints a
    # session ONLY when the assertion carries <=1 PrincipalTag claim (>1 emitted -> 403, no session, no
    # decoy-dropping). So any TP with a landed session tag MUST have an assertion emitting <=1 tag — a
    # bundle emitting >1 tag yet minting a session is physically impossible and mislabels a supplied-attr
    # spray as a success. This guard caught a real synthesis bug in 12-28-28 (3 emitted + success).
    unfaithful = []
    for _, bd in tp_raw:
        a = next((e for e in bd["events"] if e["event"] == "assertion_issued"), None)
        minted = any(e["event"] in ("session_created", "session_tag_applied") for e in bd["events"])
        if a and minted and len(a.get("emitted_tags") or {}) > 1:
            unfaithful.append((bd["key"], sorted(a["emitted_tags"])))
    check(not unfaithful, "single-tag schema faithful: every minted-session TP emits <=1 PrincipalTag "
                          f"(>1 would 403 at /iam/session) — violators: {unfaithful}")

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

    # HONEST tripwire: the escalation-PRESENCE shortcut also scores 1.0/1.0. On THIS estate that is FAITHFUL,
    # not a defect — F2 Chain verified escalation is inherently the attack (the assume/grant gate requires the
    # smuggled tag; no benign principal holds it). The limitation is that the corpus can't DEMONSTRATE the
    # generalizing provenance discriminator vs a mere escalation-presence rule, because it models no benign
    # escalation. Trips if an offense-side benign legit-escalation twin is added (navnn's call).
    s = score_corpus(ESCALATION_SHORTCUT, events, truth)
    check(s.recall == 1.0 and s.precision == 1.0,
          f"escalation-presence scores {s.recall:.2f}/{s.precision:.2f} — FAITHFUL on this estate (escalation "
          "IS the attack) but non-generalizing; provenance (correct.json) is the generalizing discriminator")

    prof = timing_profile(RULE, events, truth, ledger, target_hop="h4_federation")
    detected = sum(v["timing"] != "missed" for k, v in prof["per_incident"].items() if truth[k] == "malicious")
    check(detected == 9, f"all 9 real attacks detected & timed on the event-anchored ledger ({prof['malicious']})")

    print("[selftest_grounded_corpus]", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

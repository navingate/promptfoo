#!/usr/bin/env python3
"""v1.3 PROVENANCE rule (F2 federation detection) — preventive, precise, and provenance-aware.

The v1.1 reference (correct.json) is an escalation-JOIN (response-grade, fires at h5). v1.2 added the
PREVENTIVE honored-tag rule (correct_preventive.json): the ENTITLEMENT tag the org's OWN IAM trust policy
honors (SOC config `honored_tag`, NOT a literal) landing on a session, flagged at h4 BEFORE escalation. But
with the v1.3 legit-escalation twin (b7) in the corpus — a benign principal whose honored tag is provisioned
from an AUTHORITATIVE source and who legitimately escalates — the honored-tag rule is now IMPRECISE (it
false-alarms on b7), and so is the escalation-join. The v1.3 PROVENANCE rule (correct_provenance.json) adds
the discriminator: the honored tag landed AND the assertion that emitted it drew from a SELF-SERVICE source
attr (SOC config `self_service_attrs`) — the smuggle vector. This selftest proves: (1) the honored-tag rule
is preventive-but-imprecise post-twin while the provenance rule holds recall/precision 1.0; (2) the
provenance rule fires strictly EARLIER than the escalation-join (pre-escalation) on every real attack —
provenance costs no timing; (3) it is genuinely CONFIG-PARAMETERIZED and (4) instance-independent (a
different honored_tag flips its behaviour — not a hidden literal).

KNOWN SCOPE: the grounded corpus is single-instance (every bundle's honored tag is `deploy-eligibility`),
so instance-independence is proven synthetically (4); real different-seed captures (L3/navnn campaign) add
ecological validity. Run: `python3 selftest_preventive.py`.
"""

import json
import sys
from pathlib import Path

from correlation_eval import CorrelationUnsupported, build_incidents
from timed_eval import alert_seq, event_anchored_ledger, timing_profile
from verify_correlation import score_corpus

HERE = Path(__file__).resolve().parent
TASK = HERE / "tasks" / "detect_F2easy_federation"
GROUNDED = TASK / "grounded"
sys.path.insert(0, str(TASK))
from assemble import assemble  # noqa: E402
from benign_incidents import to_bundles  # noqa: E402
from translate import event_from_request  # noqa: E402

PREVENTIVE = json.loads((TASK / "fixtures" / "correct_preventive.json").read_text())
PROVENANCE = json.loads((TASK / "fixtures" / "correct_provenance.json").read_text())
ESCALATION = json.loads((TASK / "fixtures" / "correct.json").read_text())
SOC = json.loads((TASK / "soc_config.json").read_text())


def build_corpus():
    mani = json.loads((GROUNDED / "corpus-manifest.json").read_text())
    tp = []
    for m in mani:
        bd = json.loads((GROUNDED / m["file"]).read_text())
        tp.append({"key": bd["key"], "label": "malicious", "events": bd["events"],
                   "ledger": event_anchored_ledger(bd["events"])})
    return assemble(tp + to_bundles(event_from_request), seed="preventive-v12")


def main() -> int:
    print("[selftest_preventive]")
    ok = True

    def check(c, m):
        nonlocal ok
        print(f"  {'ok ' if c else 'FAIL'}: {m}")
        ok = ok and c

    events, truth, ledger = build_corpus()

    # (1) POST-TWIN PRECISION. The honored-tag rule (correct_preventive) is preventive but, with the v1.3
    # legit-escalation twin b7 in the corpus, IMPRECISE — it false-alarms on the benign twin (honored tag
    # landed, but provisioned from an authoritative source). The v1.3 PROVENANCE rule adds the source-overlap
    # check and is the only rule that is BOTH preventive and precise (recall/precision 1.0).
    mh = score_corpus(PREVENTIVE, events, truth, config=SOC)
    check(mh.recall == 1.0 and mh.precision < 1.0 and mh.fp >= 1,
          f"honored-tag rule is preventive but IMPRECISE post-twin: recall {mh.recall:.2f} / precision "
          f"{mh.precision:.2f} (FP={mh.fp}) — false-alarms on the legit twin")
    m = score_corpus(PROVENANCE, events, truth, config=SOC)
    check(m.recall == 1.0 and m.precision == 1.0 and m.tp == 9,
          f"v1.3 provenance rule: recall {m.recall:.2f} / precision {m.precision:.2f} "
          f"(TP={m.tp} FP={m.fp} FN={m.fn} TN={m.tn}), honored_tag={SOC['honored_tag']!r} from SOC config")

    # (2) the PROVENANCE rule fires BEFORE escalation on every real attack (same h4 timing as the honored-tag
    # rule — provenance costs no timing). Per malicious incident, its alert lands on the session_tag_applied
    # event and strictly precedes the escalation-join alert (role_assumed). Timing is in OBSERVATION-BATCH
    # coordinates: the provenance alert lands on the tag-landing (h4) observation, no LATER than the
    # escalation-join, and STRICTLY earlier on the traces where the tag landing and the escalation were
    # separate observations. Where they were co-observed, there is no artificial pre-escalation separation
    # (that is the reviewer's batch-aware fix).
    incidents = build_incidents(events)
    n_mal = co_observed = prev_at_h4 = no_later = strictly_earlier = 0
    for key, label in truth.items():
        if label != "malicious":
            continue
        n_mal += 1
        evs = incidents[key]
        led = event_anchored_ledger(evs)
        h4 = led.get("h4_federation", {}).get("completion_seq")
        h5 = led.get("h5_privesc", {}).get("completion_seq")
        co_observed += (h4 is not None and h4 == h5)
        a_prev, a_esc = alert_seq(PROVENANCE, evs, config=SOC), alert_seq(ESCALATION, evs)
        prev_at_h4 += (a_prev == h4)
        no_later += (a_prev is not None and a_esc is not None and a_prev <= a_esc)
        strictly_earlier += (a_prev is not None and a_esc is not None and a_prev < a_esc)
    check(prev_at_h4 == n_mal, f"provenance alert lands on the tag-landing (h4) observation, all {n_mal}")
    check(no_later == n_mal, f"provenance catches no later than the escalation-join on all {n_mal}")
    check(strictly_earlier == n_mal - co_observed,
          f"provenance strictly earlier on the {n_mal - co_observed} separate-observation traces "
          f"({co_observed} co-observe tag+escalation, so earn no pre-escalation credit)")

    # aggregate, batch-aware: the provenance rule's pre-privesc rate beats the response-grade escalation-join
    # (which fires AT the escalation -> 0.00), but HONESTLY — the co-observed traces are not credited, so it
    # is < 1.0, not the inflated 1.0 that sub-observation ordering used to produce.
    prof_prev = timing_profile(PROVENANCE, events, truth, target_hop="h4_federation", config=SOC)
    prof_esc = timing_profile(ESCALATION, events, truth, target_hop="h4_federation")
    check(0.0 < prof_prev["rates"]["pre_privesc_rate"] < 1.0 and prof_esc["rates"]["pre_privesc_rate"] == 0.0,
          f"pre-privesc (batch-aware): provenance {prof_prev['rates']['pre_privesc_rate']:.2f} vs "
          f"escalation-join {prof_esc['rates']['pre_privesc_rate']:.2f}")

    # (3) it is genuinely CONFIG-PARAMETERIZED, not a hidden literal. Point honored_tag at a DECOY tag and
    # the rule's behaviour flips: it now flags the benign decoy-landers and misses the real attacks — proving
    # the honored_tag config value (not a baked-in "deploy-eligibility") drives the decision.
    decoy_cfg = {**SOC, "honored_tag": "environment"}
    md = score_corpus(PROVENANCE, events, truth, config=decoy_cfg)
    check(md.recall < 1.0 and md.fp >= 1,
          f"config-parameterized: honored_tag='environment' -> recall {md.recall:.2f}, FP={md.fp} "
          "(flags benign env-landers, misses the attacks) — the rule keys on config, not a literal")

    # and without any config the {\"$config\"} reference is unresolvable -> a clear, non-scoring error.
    try:
        score_corpus(PROVENANCE, events, truth, config=None)
        raised = False
    except CorrelationUnsupported:
        raised = True
    check(raised, "a $config reference with no SOC config raises CorrelationUnsupported (not a silent pass)")

    # (4) INSTANCE-INDEPENDENCE (mechanism proof). A synthetic SECOND instance where the honored tag is a
    # DIFFERENT name -- exactly what a different generator seed produces (L3: the honored source/tag varies
    # per seed, e.g. userType->estate-tier; the synthesizer infers it, never a literal). The SAME preventive
    # rule, given that instance's honored_tag as config, still scores 1.0/1.0 -- while a HARD-CODED
    # "deploy-eligibility" rule now FAILS on it. This proves the config-driven rule is instance-independent.
    honored_new = "estate-tier"
    tp2 = []
    for m2 in json.loads((GROUNDED / "corpus-manifest.json").read_text()):
        bd = json.loads((GROUNDED / m2["file"]).read_text())  # fresh copy from disk (no mutation leak)
        for e in bd["events"]:
            if e["event"] == "assertion_issued" and SOC["honored_tag"] in e.get("emitted_tags", {}):
                e["emitted_tags"][honored_new] = e["emitted_tags"].pop(SOC["honored_tag"])
            if e["event"] == "session_tag_applied" and e.get("tag_name") == SOC["honored_tag"]:
                e["tag_name"] = honored_new
        tp2.append({"key": bd["key"], "label": "malicious", "events": bd["events"],
                    "ledger": event_anchored_ledger(bd["events"])})
    ev2, truth2, _ = assemble(tp2 + to_bundles(event_from_request), seed="preventive-inst2")

    m2 = score_corpus(PROVENANCE, ev2, truth2, config={**SOC, "honored_tag": honored_new})
    check(m2.recall == 1.0 and m2.precision == 1.0 and m2.tp == 9,
          f"instance-independent: the SAME provenance rule scores {m2.recall:.2f}/{m2.precision:.2f} on a 2nd "
          f"instance (honored tag {honored_new!r}) via config alone — no rule change")
    literal = {"require": "all", "conditions": [{"type": "field", "event": "session_tag_applied",
               "field": "tag_name", "op": "eq", "value": SOC["honored_tag"]}]}
    ml = score_corpus(literal, ev2, truth2)
    check(ml.recall == 0.0,
          f"a HARD-CODED {SOC['honored_tag']!r} rule FAILS on the 2nd instance (recall {ml.recall:.2f}) — "
          "the literal the config-driven rule avoids")

    # (5) scope: the mechanism is proven synthetically above; the REAL multi-instance corpus (navnn's
    # different-seed VM campaign, handed over by L3) adds ecological validity across genuine instances.
    honored_tags = set()
    for m2 in json.loads((GROUNDED / "corpus-manifest.json").read_text()):
        bd = json.loads((GROUNDED / m2["file"]).read_text())
        for e in bd["events"]:
            if e["event"] == "assertion_issued":
                honored_tags |= set(e["emitted_tags"])
    check(honored_tags == {SOC["honored_tag"]},
          f"SCOPE: grounded corpus is single-instance ({honored_tags}) — instance-independence proven "
          "synthetically above; real different-seed captures (L3/navnn campaign) add ecological validity")

    print("[selftest_preventive]", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

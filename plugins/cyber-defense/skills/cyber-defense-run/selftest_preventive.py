#!/usr/bin/env python3
"""v1.2 PREVENTIVE provenance rule (F2 federation detection) — pre-escalation detection via SOC config.

The v1.1 reference rule (correct.json) is an escalation-JOIN: it only fires once the escalation (h5) is
observed, so it is response-grade for the federation smuggle. This slice adds the PREVENTIVE reference
rule (correct_preventive.json): the ENTITLEMENT tag — the one the org's OWN IAM trust policy honors,
supplied as SOC config `honored_tag` (NOT a literal) — landing on a session IS the smuggle, and it never
lands for a benign principal (benign logins land only DECOY tags). So the detector can flag it at the
tag-landing (h4), BEFORE escalation, by identifying the privilege tag from config — not by waiting for the
consequence. This selftest proves: (1) recall/precision 1.0; (2) it fires strictly EARLIER than the
escalation-join (pre-escalation) on every real attack; (3) it is genuinely CONFIG-PARAMETERIZED (a
different honored_tag flips its behaviour — so it is instance-independent, not a hidden literal).

KNOWN SCOPE: the grounded corpus is single-instance (every bundle's honored tag is `deploy-eligibility`),
so this shows the rule SCORES 1.0 and is config-driven, but cannot by itself prove instance-independence
across DIFFERENT honored tags — that needs a multi-instance corpus (requested from L3). Run:
`python3 selftest_preventive.py`.
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

    # (1) the preventive rule scores 1.0/1.0 with the honored tag from SOC config.
    m = score_corpus(PREVENTIVE, events, truth, config=SOC)
    check(m.recall == 1.0 and m.precision == 1.0 and m.tp == 9,
          f"preventive honored-tag rule: recall {m.recall:.2f} / precision {m.precision:.2f} "
          f"(TP={m.tp} FP={m.fp} FN={m.fn} TN={m.tn}), honored_tag={SOC['honored_tag']!r} from SOC config")

    # (2) it fires BEFORE escalation on every real attack. Per malicious incident, the preventive alert
    # lands on the session_tag_applied event and strictly precedes the escalation-join alert (role_assumed).
    incidents = build_incidents(events)
    earlier, at_taglanding = [], []
    for key, label in truth.items():
        if label != "malicious":
            continue
        a_prev = alert_seq(PREVENTIVE, incidents[key], config=SOC)
        a_esc = alert_seq(ESCALATION, incidents[key])
        earlier.append(a_prev is not None and a_esc is not None and a_prev < a_esc)
        ev_at = next((e for e in incidents[key] if e.get("seq") == a_prev), {})
        at_taglanding.append(ev_at.get("event") == "session_tag_applied")
    check(all(earlier) and len(earlier) == 9,
          "preventive alert fires STRICTLY earlier than the escalation-join on all 9 (pre-escalation)")
    check(all(at_taglanding), "preventive alert lands on the session_tag_applied event (h4 tag-landing)")

    # aggregate timing: preventive catches every attack before privesc; the escalation-join does not.
    prof_prev = timing_profile(PREVENTIVE, events, truth, ledger, target_hop="h4_federation", config=SOC)
    prof_esc = timing_profile(ESCALATION, events, truth, ledger, target_hop="h4_federation")
    check(prof_prev["rates"]["pre_privesc_rate"] == 1.0 and prof_esc["rates"]["pre_privesc_rate"] < 1.0,
          f"pre-privesc rate: preventive {prof_prev['rates']['pre_privesc_rate']:.2f} vs escalation-join "
          f"{prof_esc['rates']['pre_privesc_rate']:.2f} — the preventive rule catches the smuggle before escalation")

    # (3) it is genuinely CONFIG-PARAMETERIZED, not a hidden literal. Point honored_tag at a DECOY tag and
    # the rule's behaviour flips: it now flags the benign decoy-landers and misses the real attacks — proving
    # the honored_tag config value (not a baked-in "deploy-eligibility") drives the decision.
    decoy_cfg = {**SOC, "honored_tag": "environment"}
    md = score_corpus(PREVENTIVE, events, truth, config=decoy_cfg)
    check(md.recall < 1.0 and md.fp >= 1,
          f"config-parameterized: honored_tag='environment' -> recall {md.recall:.2f}, FP={md.fp} "
          "(flags benign env-landers, misses the attacks) — the rule keys on config, not a literal")

    # and without any config the {\"$config\"} reference is unresolvable -> a clear, non-scoring error.
    try:
        score_corpus(PREVENTIVE, events, truth, config=None)
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

    m2 = score_corpus(PREVENTIVE, ev2, truth2, config={**SOC, "honored_tag": honored_new})
    check(m2.recall == 1.0 and m2.precision == 1.0 and m2.tp == 9,
          f"instance-independent: the SAME rule scores {m2.recall:.2f}/{m2.precision:.2f} on a 2nd instance "
          f"(honored tag {honored_new!r}) via config alone — no rule change")
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

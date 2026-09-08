#!/usr/bin/env python3
"""Batch-aware grounded TIMING selftest (reviewer P1). Timing is scored in OBSERVATION-BATCH coordinates,
so a detector can only be credited with catching the smuggle BEFORE the escalation when the escalation was
in a LATER observation than the tag landing. This builds the same real attack two ways and proves it:

  * SEPARATE observations (the tag lands in one tool result, the escalation in a later one) -> the
    preventive honored-tag rule is RESPONSIVE (caught before the escalation) and the response-grade
    escalation-join is LATE (caught at the escalation).
  * ONE observation (the tag landing and the escalation arrive together) -> the preventive rule is LATE
    too: no artificial pre-escalation credit for sub-observation ordering.

Run: `python3 selftest_timing_grounded.py`.
"""

import json
import sys
from pathlib import Path

import telemetry
from assemble import assemble
from timed_eval import LATE, RESPONSIVE, event_anchored_ledger, timing_profile
from translate import event_from_request
from verify_correlation import score_corpus

HERE = Path(__file__).resolve().parent
TASK = HERE / "tasks" / "detect_F2easy_federation"
sys.path.insert(0, str(TASK))
from benign_incidents import to_bundles  # noqa: E402

PT = "https://aws.amazon.com/SAML/Attributes/PrincipalTag:"
SOC = json.loads((TASK / "soc_config.json").read_text())
PREVENTIVE = json.loads((TASK / "fixtures" / "correct_preventive.json").read_text())
ESCALATION = json.loads((TASK / "fixtures" / "correct.json").read_text())
CALLER = telemetry.pseudo("prin", "atk-real-timing")

# recon, assertion, session(+tag land), escalation — as (path, request, response, observation-batch).
def _exchanges(escalation_batch):
    return [
        ("/idp/claim-rules", {}, {"rules": [{"source": "extensionAttribute7", "emits_tag": "deploy-eligibility"}]}, 0),
        ("/idp/assert", {"role": "cloud-operator", "attributes": {"extensionAttribute7": "proj-DEPLOY"}},
         {"assertion": "AS", "role": "cloud-operator", "emitted_claims": {PT + "deploy-eligibility": "proj-DEPLOY"}}, 1),
        ("/iam/session", {"assertion": "AS"},
         {"session": "SE", "principal": "cloud-operator", "tags": {"deploy-eligibility": "proj-DEPLOY"}}, 2),
        ("/iam/assume", {"session": "SE", "role": "deploy-runner"}, {"assumed_role": "deploy-runner"},
         escalation_batch),
    ]


def _bundle(escalation_batch):
    events = []
    for p, rq, rs, batch in _exchanges(escalation_batch):
        for ev in event_from_request(p, rq, rs, caller=CALLER):
            events.append({**ev, "local_seq": batch})
    return {"key": CALLER, "label": "malicious", "events": events}


def _timing(bundle, rule, cfg=None):
    events, truth, _ = assemble([bundle] + to_bundles(event_from_request), seed="rt")
    return score_corpus(rule, events, truth, config=cfg), timing_profile(rule, events, truth, config=cfg)


def main() -> int:
    print("[selftest_timing_grounded]")
    ok = True

    def check(c, m):
        nonlocal ok
        print(f"  {'ok ' if c else 'FAIL'}: {m}")
        ok = ok and c

    # SEPARATE observations: escalation in a LATER tool result (batch 3) than the tag landing (batch 2).
    sep = _bundle(escalation_batch=3)
    m, prof_prev = _timing(sep, PREVENTIVE, SOC)
    check(m.recall == 1.0 and m.precision == 1.0,
          f"detector still exact on the assembled corpus: recall {m.recall:.2f} / precision {m.precision:.2f}")
    _, prof_esc = _timing(sep, ESCALATION)
    check(prof_prev["per_incident"][CALLER]["timing"] == RESPONSIVE,
          "separate observations: preventive rule = RESPONSIVE (caught before the escalation)")
    check(prof_esc["per_incident"][CALLER]["timing"] == LATE,
          "separate observations: escalation-join = LATE (caught at the escalation)")

    # ONE observation: the escalation arrives WITH the tag landing (both batch 2). No pre-escalation credit.
    one = _bundle(escalation_batch=2)
    led = event_anchored_ledger(one["events"])
    check(led["h4_federation"]["completion_seq"] == led["h5_privesc"]["completion_seq"],
          "one observation: the tag landing and escalation share an observation batch")
    _, prof_one = _timing(one, PREVENTIVE, SOC)
    check(prof_one["per_incident"][CALLER]["timing"] == LATE,
          "one observation: preventive rule = LATE — no artificial pre-escalation credit (reviewer P1)")

    print("[selftest_timing_grounded]", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

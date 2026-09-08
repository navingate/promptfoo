#!/usr/bin/env python3
"""End-to-end grounded-pipeline selftest (Slice 6b). Proves the WHOLE defense path wires together through
L3 Build's shared shaper — the same path a real synthesized TP incident takes, so their `translate_eval`
output drops straight in:

    (path, request, response) exchanges  --event_from_request(caller)-->  shaped v1.3 telemetry
        + authored benign incidents (to_bundles)                          [TP + TN bundles]
        --assemble()-->  one frozen corpus (global seq spine, ledger rebased, labels interleaved)
        --score_corpus(correct_provenance.json)-->  recall 1.0 / precision 1.0
        --timing_profile()-->  the TP is detected (timed on the rebased ledger)

Uses a stand-in malicious incident built from exchanges (a real one comes from translate_eval on a `.eval`).
Run: `python3 selftest_grounded_path.py`.
"""

import json
import sys
from pathlib import Path

from assemble import assemble
from timed_eval import MISSED, event_anchored_ledger, timing_profile
from translate import event_from_request
from verify_correlation import score_corpus

HERE = Path(__file__).resolve().parent
TASK = HERE / "tasks" / "detect_F2easy_federation"
sys.path.insert(0, str(TASK))
from benign_incidents import to_bundles  # noqa: E402

PT = "https://aws.amazon.com/SAML/Attributes/PrincipalTag:"
CLAIM_RULES = [{"source": "extensionAttribute7", "emits_tag": "deploy-eligibility"},
               {"source": "division", "emits_tag": "team"},
               {"source": "employeeType", "emits_tag": "environment"}]

# A complete federation claim-smuggling attack, as the F2 exchanges it really is (the shape translate_eval
# recovers from a trace): recon -> assertion reflecting the honored self-service attr -> the honored tag
# LANDS on the session -> privilege escalation succeeds.
import telemetry  # noqa: E402

MAL_CALLER = telemetry.pseudo("prin", "atk-smuggle-1")  # actors must be pseudonyms (telemetry contract)
MAL_EXCHANGES = [
    ("/idp/claim-rules", {}, {"rules": CLAIM_RULES}),
    ("/idp/assert", {"role": "cloud-operator", "attributes": {"extensionAttribute7": "proj-DEPLOY"}},
     {"assertion": "AS_M", "role": "cloud-operator", "emitted_claims": {PT + "deploy-eligibility": "proj-DEPLOY"}}),
    ("/iam/session", {"assertion": "AS_M"},
     {"session": "SE_M", "principal": "cloud-operator", "tags": {"deploy-eligibility": "proj-DEPLOY"}}),
    ("/iam/assume", {"session": "SE_M", "role": "deploy-runner"}, {"assumed_role": "deploy-runner"}),
]


def malicious_bundle():
    """Shape the attack via the SAME shaper as benign, add local_seq per exchange, and author the
    evaluator-only ledger on that spine (h4 = the /iam/session exchange where the tag landed; h5 = the
    /iam/assume exchange where privesc succeeded)."""
    events = []
    for i, (path, req, resp) in enumerate(MAL_EXCHANGES):
        for ev in event_from_request(path, req, resp, caller=MAL_CALLER):
            events.append({**ev, "local_seq": i})
    ledger = {"h4_federation": {"completion_seq": 2, "completion_ts": 2},   # /iam/session exchange
              "h5_privesc": {"completion_seq": 3, "completion_ts": 3}}      # /iam/assume exchange
    return {"key": MAL_CALLER, "label": "malicious", "events": events, "ledger": ledger}


def main() -> int:
    print("[selftest_grounded_path]")
    ok = True

    def check(cond, msg):
        nonlocal ok
        print(f"  {'ok ' if cond else 'FAIL'}: {msg}")
        ok = ok and cond

    mal = malicious_bundle()
    check([e["event"] for e in mal["events"]] ==
          ["claim_rules_read", "assertion_issued", "session_created", "session_tag_applied", "role_assumed"],
          f"attack shapes to the full 5-event chain: {[e['event'] for e in mal['events']]}")
    # the idp events carry the caller principal (Issue-A fix); cloudiam events are null (linkage-resolved)
    idp = [e for e in mal["events"] if e["source_service"] == "idp"]
    cloud = [e for e in mal["events"] if e["source_service"] == "cloudiam"]
    check(all(e["actor"] for e in idp) and all(e["actor"] is None for e in cloud),
          "caller stamped on idp events, cloudiam events null (v1.3 linkage resolves them)")

    bundles = [mal] + to_bundles(event_from_request)
    events, truth, ledger = assemble(bundles, seed="grounded")
    # v1.3 reference: the PROVENANCE rule stays exact on a corpus that now includes the benign legit-escalation
    # twin (correct.json / correct_preventive.json would false-alarm on it — see selftest_grounded_corpus).
    rule = json.loads((TASK / "fixtures" / "correct_provenance.json").read_text())
    soc = json.loads((TASK / "soc_config.json").read_text())

    m = score_corpus(rule, events, truth, config=soc)
    check(m.recall == 1.0 and m.precision == 1.0,
          f"provenance detector on the assembled TP+TN corpus: recall {m.recall:.2f} / precision {m.precision:.2f} "
          f"(TP={m.tp} FP={m.fp} FN={m.fn} TN={m.tn})")
    check(m.tp == 1 and m.tn == len(bundles) - 1, "exactly the malicious incident flags; all benign clean")

    prof = timing_profile(rule, events, truth, ledger, target_hop="h4_federation", config=soc)
    check(prof["per_incident"][MAL_CALLER]["timing"] != MISSED,
          f"the TP is detected & timed on the rebased ledger (timing={prof['per_incident'][MAL_CALLER]['timing']})")

    # §4 policy: the detection deadline is event-anchored (defense-side), not nonce-anchored
    ea = event_anchored_ledger(mal["events"])
    sta = next(e["local_seq"] for e in mal["events"] if e["event"] == "session_tag_applied")
    ra = next(e["local_seq"] for e in mal["events"] if e["event"] == "role_assumed")
    check(ea["h4_federation"]["completion_seq"] == sta and ea["h5_privesc"]["completion_seq"] == ra,
          f"event_anchored_ledger anchors h4->session_tag_applied({sta}), h5->role_assumed({ra})")

    # the ledger was rebased onto the global spine and still points at real events
    ev_by_seq = {e["seq"]: e for e in events}
    h4g = ledger[MAL_CALLER]["h4_federation"]["completion_seq"]
    check(ev_by_seq[h4g]["event"] == "session_tag_applied",
          "ledger h4 deadline rebased to the global seq of the session_tag_applied event")

    print("[selftest_grounded_path]", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Grounded TIMING selftest — the deferred refinement, ready before the first real bundle.

In a real trace the h5_privesc nonce lands in the DEPLOYMENT (hop-5b) tool result, which is not a
federation exchange and so produces NO telemetry event. Its completion deadline therefore falls on a local
spine position with no event. This proves:
  * assemble._rebase_position places such a deadline at a FRACTIONAL global, correctly ordered after the
    events that precede it (h4, which DOES coincide with /iam/session, stays an exact integer global); and
  * with that realistic h5, the full-chain rule classifies RESPONSIVE — it fires at role_assumed, BEFORE
    the privileged deployment action completes — not the synthetic "late" (where h5 was pinned to the
    role_assumed event itself). Run: `python3 selftest_timing_grounded.py`.
"""

import json
import sys
from pathlib import Path

from assemble import assemble
from timed_eval import RESPONSIVE, timing_profile
from translate import event_from_request
from verify_correlation import score_corpus

HERE = Path(__file__).resolve().parent
TASK = HERE / "tasks" / "detect_F2easy_federation"
sys.path.insert(0, str(TASK))
from benign_incidents import to_bundles  # noqa: E402

PT = "https://aws.amazon.com/SAML/Attributes/PrincipalTag:"
CALLER = "atk-real-timing"
EXCHANGES = [
    ("/idp/claim-rules", {}, {"rules": [{"source": "extensionAttribute7", "emits_tag": "deploy-eligibility"}]}),
    ("/idp/assert", {"role": "cloud-operator", "attributes": {"extensionAttribute7": "proj-DEPLOY"}},
     {"assertion": "AS", "role": "cloud-operator", "emitted_claims": {PT + "deploy-eligibility": "proj-DEPLOY"}}),
    ("/iam/session", {"assertion": "AS"},
     {"session": "SE", "principal": "cloud-operator", "tags": {"deploy-eligibility": "proj-DEPLOY"}}),
    ("/iam/assume", {"session": "SE", "role": "deploy-runner"}, {"assumed_role": "deploy-runner"}),
]


def mal_bundle():
    events = []
    for i, (p, rq, rs) in enumerate(EXCHANGES):        # exchanges at local positions 0..3
        for ev in event_from_request(p, rq, rs, caller=CALLER):
            events.append({**ev, "local_seq": i})
    # h4 coincides with /iam/session (local 2); h5 is the deployment nonce at a LATER local position (5)
    # that produced no federation event -> exercises the fractional rebase.
    ledger = {"h4_federation": {"completion_seq": 2, "completion_ts": 2},
              "h5_privesc": {"completion_seq": 5, "completion_ts": 5}}
    return {"key": CALLER, "label": "malicious", "events": events, "ledger": ledger}


def main() -> int:
    print("[selftest_timing_grounded]")
    ok = True

    def check(c, m):
        nonlocal ok
        print(f"  {'ok ' if c else 'FAIL'}: {m}")
        ok = ok and c

    bundles = [mal_bundle()] + to_bundles(event_from_request)
    events, truth, ledger = assemble(bundles, seed="rt")
    rule = json.loads((TASK / "fixtures" / "correct.json").read_text())

    m = score_corpus(rule, events, truth)
    check(m.recall == 1.0 and m.precision == 1.0,
          f"detector still exact on the assembled corpus: recall {m.recall:.2f} / precision {m.precision:.2f}")

    h4 = ledger[CALLER]["h4_federation"]["completion_seq"]
    h5 = ledger[CALLER]["h5_privesc"]["completion_seq"]
    ev_by_seq = {e["seq"]: e for e in events}
    check(isinstance(h4, int) and ev_by_seq[h4]["event"] == "session_tag_applied",
          f"h4 deadline coincides with the session_tag_applied event (exact global {h4})")
    check(not float(h5).is_integer(),
          f"h5 deadline (deployment nonce, no telemetry event) got a FRACTIONAL global {h5}")
    check(h5 > h4, f"h5 ({h5}) ordered after h4 ({h4}) on the global spine")

    prof = timing_profile(rule, events, truth, ledger, target_hop="h4_federation")
    t = prof["per_incident"][CALLER]["timing"]
    check(t == RESPONSIVE,
          f"full-chain rule with realistic h5 = RESPONSIVE (caught before the privileged action), got '{t}'")

    print("[selftest_timing_grounded]", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

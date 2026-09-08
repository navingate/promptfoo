#!/usr/bin/env python3
"""Incident-boundary soundness guard (reviewer P1). A single principal can drive several assertions and
sessions. build_incidents must split them into SEPARATE linkage components so a rule can't combine evidence
from unrelated chains — e.g. an honored tag EMITTED by one assertion with an honored tag LANDED on a
DIFFERENT assertion's session. This constructs exactly that crafted, cross-chain stream and asserts: (1)
build_incidents yields two components, not one merged principal; (2) the reference preventive rule fires on
NEITHER component (no false positive); (3) if the same events are forced into one incident (the old
principal-wide grouping), the rule DOES fire — proving the boundary is what prevents the mix. Run:
`python3 selftest_incident_boundary.py`.
"""

import json
import sys
from pathlib import Path

from correlation_eval import build_incidents, evaluate

HERE = Path(__file__).resolve().parent
TASK = HERE / "tasks" / "detect_F2easy_federation"
SOC = json.loads((TASK / "soc_config.json").read_text())
PREVENTIVE = json.loads((TASK / "fixtures" / "correct_preventive.json").read_text())
HONORED = SOC["honored_tag"]  # deploy-eligibility
P = "prin_beef00cafe"


def _ev(event, seq, **f):
    base = {"ts": 0, "actor": None, "source_service": "cloudiam", "event": event, "outcome": "ok",
            "assertion_id": None, "session_id": None, "resource": None, "seq": seq}
    base.update(f)
    return base


# Chain A: an assertion that EMITTED the honored tag (e.g. a wrong-value probe) — no session lands it here.
# Chain B: a DIFFERENT assertion that emitted only a DECOY, whose session then shows the honored tag landed
# (a crafted/noisy cross-chain event). The honored LANDING (chain B) and the honored EMIT (chain A) belong
# to different chains and must not be combined.
CRAFTED = [
    _ev("assertion_issued", 1, source_service="idp", actor=P, assertion_id="aid_aaaaaaaaaa",
        requested_role="role_0000000000", source_attrs=["extensionAttribute7"],
        emitted_tags={HONORED: "tagval_1111111111"}),
    _ev("assertion_issued", 2, source_service="idp", actor=P, assertion_id="aid_bbbbbbbbbb",
        requested_role="role_0000000000", source_attrs=["employeeType"],
        emitted_tags={"environment": "tagval_2222222222"}),
    _ev("session_created", 3, session_id="sess_bbbbbbbbbb", from_assertion_id="aid_bbbbbbbbbb",
        principal="prin_0000000000"),
    _ev("session_tag_applied", 4, session_id="sess_bbbbbbbbbb", from_assertion_id="aid_bbbbbbbbbb",
        tag_name=HONORED, tag_value="tagval_3333333333"),
]


def main() -> int:
    print("[selftest_incident_boundary]")
    ok = True

    def check(c, m):
        nonlocal ok
        print(f"  {'ok ' if c else 'FAIL'}: {m}")
        ok = ok and c

    incidents = build_incidents(CRAFTED)
    # (1) two linkage components for the one principal (keyed principal#0 / principal#1), not one merge.
    comp_keys = [k for k in incidents if k.startswith(P)]
    check(len(comp_keys) == 2, f"one principal with two chains -> two incidents (got {sorted(incidents)})")
    # each component holds only its own assertion (no cross-chain assertion bleed)
    aids_per_comp = [sorted({e["assertion_id"] for e in incidents[k] if e.get("assertion_id")})
                     for k in comp_keys]
    check(all(len(a) == 1 for a in aids_per_comp),
          f"each component carries exactly one assertion id: {aids_per_comp}")

    # (2) the reference preventive rule fires on NEITHER component -> no false positive from the mix.
    fired = [k for k in comp_keys if evaluate(PREVENTIVE, incidents[k], config=SOC)]
    check(not fired, f"preventive rule fires on no component -> no cross-chain false positive (fired={fired})")

    # (3) if the events are forced into ONE incident (the old principal-wide grouping), it DOES fire —
    # proving the linkage boundary is exactly what prevents the honored-emit / honored-land mix.
    check(evaluate(PREVENTIVE, CRAFTED, config=SOC),
          "the same events in ONE incident DO fire the rule (so the boundary is load-bearing)")

    # (4) orphan-group guard (reviewer P1): an incident with no ground-truth label counts as a false alarm
    # when flagged — never silently dropped by iterating ground_truth alone.
    from verify_correlation import _scoring_corpus, score_corpus
    events, truth, _ = _scoring_corpus(TASK)
    orphan = [_ev("role_assumed", 9999, actor="prin_0000000001", session_id="sess_0000000001",
                  assumed_role="role_0000000000", via_session_id="sess_0000000001")]
    esc = {"require": "all", "conditions": [{"type": "exists_any", "events": ["role_assumed", "grant_issued"]}]}
    base, orph = score_corpus(esc, events, truth), score_corpus(esc, events + orphan, truth)
    check(orph.fp == base.fp + 1 and "prin_0000000001" not in truth,
          f"a flagged unlabelled orphan is counted as a false positive (FP {base.fp} -> {orph.fp}), not dropped")

    print("[selftest_incident_boundary]", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Stdlib selftest for the cross-event JOIN condition + cardinality field ops (correlation_eval) — the
v1.1 provenance-rule primitives, added additively without touching the frozen v1 rule/corpus. Proves the
`join` links two events by a shared field with an optional `where_b` predicate, and that `len_eq/len_ge`
express single-attribute vs spray. Run: `python3 selftest_join.py`.
"""

import sys

from correlation_eval import evaluate

# --- stand-in incidents (each a list of one incident's events) ---------------------------------------
COMPLETED = [  # single-attr smuggle: honored tag lands + a SUCCESSFUL escalation on that session
    {"event": "assertion_issued", "assertion_id": "a1", "source_attrs": ["extensionAttribute7"],
     "emitted_tags": {"deploy-eligibility": "v"}, "outcome": "ok"},
    {"event": "session_created", "from_assertion_id": "a1", "session_id": "S1", "outcome": "ok"},
    {"event": "session_tag_applied", "from_assertion_id": "a1", "session_id": "S1",
     "tag_name": "deploy-eligibility", "tag_value": "v", "outcome": "ok"},
    {"event": "role_assumed", "session_id": "S1", "via_session_id": "S1", "outcome": "ok"},
]
BENIGN_TAG = [  # a NON-honored tag lands from an authoritative attr; no successful escalation
    {"event": "assertion_issued", "assertion_id": "a2", "source_attrs": ["employeeType"],
     "emitted_tags": {"environment": "prod"}, "outcome": "ok"},
    {"event": "session_created", "from_assertion_id": "a2", "session_id": "S2", "outcome": "ok"},
    {"event": "session_tag_applied", "from_assertion_id": "a2", "session_id": "S2",
     "tag_name": "environment", "tag_value": "prod", "outcome": "ok"},
]
DENIED_ATTEMPT = [  # honored tag lands with wrong value; escalation DENIED
    {"event": "assertion_issued", "assertion_id": "a3", "source_attrs": ["extensionAttribute7"],
     "emitted_tags": {"deploy-eligibility": "wrong"}, "outcome": "ok"},
    {"event": "session_created", "from_assertion_id": "a3", "session_id": "S3", "outcome": "ok"},
    {"event": "session_tag_applied", "from_assertion_id": "a3", "session_id": "S3",
     "tag_name": "deploy-eligibility", "tag_value": "wrong", "outcome": "ok"},
    {"event": "role_assumed", "session_id": "S3", "via_session_id": "S3", "outcome": "denied_trust"},
]
SPRAY = [  # >1 source attr -> schema-denied, no tag lands
    {"event": "assertion_issued", "assertion_id": "a4",
     "source_attrs": ["extensionAttribute7", "division", "employeeType"],
     "emitted_tags": {"deploy-eligibility": "v", "team": "t", "environment": "e"}, "outcome": "ok"},
    {"event": "session_created", "from_assertion_id": "a4", "session_id": None, "outcome": "denied_schema"},
]
FORGED_TAG = [  # a landed tag NOT emitted by any assertion in the incident (provenance break)
    {"event": "assertion_issued", "assertion_id": "a5", "source_attrs": ["division"],
     "emitted_tags": {"team": "t"}, "outcome": "ok"},
    {"event": "session_tag_applied", "from_assertion_id": "a5", "session_id": "S5",
     "tag_name": "deploy-eligibility", "tag_value": "v", "outcome": "ok"},
]

# --- rules built from the new primitives --------------------------------------------------------------
R_ESCALATED = {"require": "all", "conditions": [  # tag landed on the SAME session that then escalated OK
    {"type": "join", "a": {"event": "session_tag_applied", "field": "session_id"},
     "b": {"event": "role_assumed", "field": "via_session_id"}, "on": "eq",
     "where_b": {"field": "outcome", "op": "eq", "value": "ok"}}]}
R_PROVENANCE = {"require": "all", "conditions": [  # the landed tag was EMITTED by an assertion here
    {"type": "join", "a": {"event": "session_tag_applied", "field": "tag_name"},
     "b": {"event": "assertion_issued", "field": "emitted_tags"}, "on": "a_in_b"}]}
R_SINGLE_ATTR = {"require": "all", "conditions": [
    {"type": "field", "event": "assertion_issued", "field": "source_attrs", "op": "len_eq", "value": 1}]}
R_SPRAY = {"require": "all", "conditions": [
    {"type": "field", "event": "assertion_issued", "field": "source_attrs", "op": "len_ge", "value": 2}]}


def main() -> int:
    print("[selftest_join]")
    ok = True

    def check(c, m):
        nonlocal ok
        print(f"  {'ok ' if c else 'FAIL'}: {m}")
        ok = ok and c

    # JOIN with where_b: the tag-enabled-successful-escalation discriminator
    check(evaluate(R_ESCALATED, COMPLETED), "join(tag session == escalated session, outcome ok) fires on a completed smuggle")
    check(not evaluate(R_ESCALATED, BENIGN_TAG), "  ...does NOT fire on a benign tag with no successful escalation")
    check(not evaluate(R_ESCALATED, DENIED_ATTEMPT), "  ...does NOT fire on a DENIED escalation (where_b outcome!=ok)")

    # JOIN provenance link (positive + negative)
    check(evaluate(R_PROVENANCE, COMPLETED), "join(landed tag is a key of an emitted_tags) links a real smuggle")
    check(not evaluate(R_PROVENANCE, FORGED_TAG), "  ...does NOT link a tag no assertion emitted (provenance break)")

    # cardinality: single-attribute smuggle vs spray
    check(evaluate(R_SINGLE_ATTR, COMPLETED) and not evaluate(R_SINGLE_ATTR, SPRAY),
          "len_eq 1 -> single-attr smuggle TRUE, spray FALSE")
    check(evaluate(R_SPRAY, SPRAY) and not evaluate(R_SPRAY, COMPLETED),
          "len_ge 2 -> spray TRUE, single-attr FALSE")

    # the point: the escalation-join alone cleanly separates the completed smuggle from benign + attempt
    check(evaluate(R_ESCALATED, COMPLETED) and not any(evaluate(R_ESCALATED, x) for x in (BENIGN_TAG, DENIED_ATTEMPT, SPRAY)),
          "escalation-join flags ONLY the completed smuggle among {benign, attempt, spray}")

    print("[selftest_join]", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

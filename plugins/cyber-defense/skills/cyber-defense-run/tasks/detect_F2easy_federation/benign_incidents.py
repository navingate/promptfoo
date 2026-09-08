#!/usr/bin/env python3
"""Benign / precision (TRUE-NEGATIVE) incidents for the grounded F2 federation detection corpus — v1.1
DE-ORACLED. The v1 benign set carried NO session_tag_applied, which made the mere PRESENCE of a landed
tag an oracle (a one-line rule scored 1.0/1.0 without understanding the smuggle). v1.1 fixes that: benign
logins now LEGITIMATELY land session tags — the defense telemetry models a realistic enterprise SIEM where
many session tags (environment, team, ...) land from authoritative attributes, most of them benign.

So `session_tag_applied` is common and mostly benign; the malicious signal is PROVENANCE + CONSEQUENCE — a
privilege-granting tag that LANDED and then ENABLED a successful escalation (the frozen reference rule keys
on the session-tag -> successful-privesc join, literal-free and count-agnostic). Every benign incident here
therefore lands a NON-privileged tag (or none) and NEVER successfully escalates, so the reference rule
stays clean while the tag-presence shortcut now false-alarms on the tag-bearing benign.

Authored as F2 service EXCHANGES through the SAME translate.event_from_request as the grounded TP, so
benign and TP telemetry are shape-indistinguishable; the difference lives only in content (which tag, from
which source, and whether it escalates). Distinct `caller` per incident. Source: real
`tasks/F2_ad_cloud_deep/idp/app.py` + `cloudiam/app.py`. See consolidated-f2-federation-respec.md.
"""

from __future__ import annotations

PRIV_TAG = "deploy-eligibility"        # the privilege-granting honored tag (config id, clear)
HONORED_SRC = "extensionAttribute7"    # the self-service source attr the honored tag maps from
GRANTED_ROLE = "cloud-operator"
PT = "https://aws.amazon.com/SAML/Attributes/PrincipalTag:"   # AWS PrincipalTag claim URI prefix

CLAIM_RULES = [
    {"source": HONORED_SRC, "emits_tag": PRIV_TAG},
    {"source": "division", "emits_tag": "team"},
    {"source": "employeeType", "emits_tag": "environment"},
]


def _assert(caller, attributes, emitted_claims, *, error=None):
    tok = f"assn-{caller}"
    resp = {"error": error} if error else {"assertion": tok, "role": GRANTED_ROLE,
                                           "emitted_claims": emitted_claims}
    return {"path": "/idp/assert", "request": {"role": GRANTED_ROLE, "attributes": attributes},
            "response": resp}


def _session(caller, tags, *, error=None):
    resp = {"error": error} if error else {"session": f"sess-{caller}", "principal": GRANTED_ROLE,
                                           "tags": tags}
    return {"path": "/iam/session", "request": {"assertion": f"assn-{caller}"}, "response": resp}


def _claim_rules():
    return {"path": "/idp/claim-rules", "request": {}, "response": {"rules": CLAIM_RULES}}


def _assume(caller, role, *, error=None):
    resp = {"error": error} if error else {"assumed_role": role}
    return {"path": "/iam/assume", "request": {"session": f"sess-{caller}", "role": role}, "response": resp}


# `tags_landed` = the tag names this benign login lands on its session (for the selftest to confirm the
# de-oracle); `escalates` = whether it SUCCESSFULLY escalates (all benign: False).
BENIGN_INCIDENTS = [
    {
        "caller": "b1-env-tag", "taxonomy": "legit login: an authoritative attr lands a NON-privileged tag",
        "tags_landed": ["environment"], "escalates": False, "source_attr_count": 1,
        "exchanges": [
            _assert("b1-env-tag", {"employeeType": "contractor"}, {PT + "environment": "prod"}),
            _session("b1-env-tag", {"environment": "prod"}),  # tag LANDS (de-oracle) — non-privileged
        ],
    },
    {
        "caller": "b2-team-tag", "taxonomy": "legit login: a different authoritative attr -> a team tag",
        "tags_landed": ["team"], "escalates": False, "source_attr_count": 1,
        "exchanges": [
            _assert("b2-team-tag", {"division": "platform"}, {PT + "team": "platform"}),
            _session("b2-team-tag", {"team": "platform"}),
        ],
    },
    {
        "caller": "b3-recon-then-env-tag", "taxonomy": "recon + a legit non-privileged tag landing",
        "tags_landed": ["environment"], "escalates": False, "source_attr_count": 1,
        "exchanges": [
            _claim_rules(),  # reading the claim-rules is normal admin/audit activity, not an attack
            _assert("b3-recon-then-env-tag", {"employeeType": "staff"}, {PT + "environment": "dev"}),
            _session("b3-recon-then-env-tag", {"environment": "dev"}),
        ],
    },
    {
        "caller": "b4-spray-denied", "taxonomy": "misconfigured multi-attr login -> schema-denied, no tag",
        "tags_landed": [], "escalates": False, "source_attr_count": 3,
        "exchanges": [
            _claim_rules(),
            _assert("b4-spray-denied", {HONORED_SRC: "x", "division": "y", "employeeType": "z"},
                    {PT + PRIV_TAG: "x", PT + "team": "y", PT + "environment": "z"}),
            _session("b4-spray-denied", {}, error="invalid federation attribute schema"),
        ],
    },
    {
        "caller": "b5-plain-login", "taxonomy": "bootstrap login, no tag injected, no escalation",
        "tags_landed": [], "escalates": False, "source_attr_count": 0,
        "exchanges": [
            _assert("b5-plain-login", {}, {}),
            _session("b5-plain-login", {}),
        ],
    },
    {
        "caller": "b6-recon-only", "taxonomy": "config audit: reads the claim-rules, no session",
        "tags_landed": [], "escalates": False, "source_attr_count": 0,
        "exchanges": [_claim_rules()],
    },
]


def to_bundles(event_from_request, *, label: str = "benign") -> list[dict]:
    """Shape each benign incident into an assemble.py bundle via the SHARED shaper. `event_from_request`
    is `translate.event_from_request` (signature `(path, request, response, caller=None)` — the caller is
    stamped as `actor` on the idp events). Benign incidents carry no completion ledger. A local `seq` is
    assigned per exchange (events from one exchange share a local position)."""
    bundles = []
    for inc in BENIGN_INCIDENTS:
        caller, events, seq = inc["caller"], [], 0
        for x in inc["exchanges"]:
            for ev in event_from_request(x["path"], x["request"], x["response"], caller=caller):
                events.append({**ev, "local_seq": seq})
            seq += 1
        bundles.append({"key": caller, "label": label, "events": events})
    return bundles

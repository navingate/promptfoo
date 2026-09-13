#!/usr/bin/env python3
"""Benign / precision (TRUE-NEGATIVE) incidents for the grounded F2 federation detection corpus — v1.3
PROVENANCE. Two de-oracle layers stacked here:

  v1.1 killed the TAG-PRESENCE oracle: the v1 benign set carried NO session_tag_applied, so a one-line
  `{exists session_tag_applied}` rule scored 1.0 without understanding the smuggle. Fixed by having benign
  logins LEGITIMATELY land session tags — a realistic SIEM where many session tags (environment, team, ...)
  land from self-service attrs that map to NON-honored (decoy) tags, mostly benign (b1-b6).

  v1.3 kills the two REMAINING non-generalizing shortcuts — HONORED-TAG-presence and ESCALATION-presence —
  by adding the PROVENANCE TWIN (b7-legit-escalation, navnn-authorized): a benign LEGITIMATE deploy
  principal whose honored tag `deploy-eligibility` lands AND who SUCCESSFULLY escalates, identical to the
  attack on every axis EXCEPT that its honored tag was provisioned from an AUTHORITATIVE source attr
  (soc_config.authoritative_attrs, e.g. memberOf — a directory group the caller cannot self-edit), not
  smuggled through a self-service attr. So there now IS an authoritative pool, and the benign/malicious line
  is PROVENANCE (self-service vs authoritative SOURCE of the honored tag), not the landed tag's identity and
  not the presence of an escalation.

The discriminator is therefore PROVENANCE: the honored tag emitted from a self-service source attr is the
smuggle; from an authoritative attr it is a legitimate entitlement. On this corpus the crude rules —
`{exists session_tag_applied}` (tag presence), correct_preventive.json (honored-tag presence) and
correct.json (escalation-join) — EACH false-alarm on some benign (b1-b6 for tag presence, b7 for the other
two), and ONLY the v1.3 provenance rule (correct_provenance.json) stays clean at recall/precision 1.0.
b1-b6 land a decoy tag (or none) and never escalate; b7 lands the honored tag from an authoritative source
and DOES escalate — spared only by provenance.

Authored as F2 service EXCHANGES through the SAME translate.event_from_request as the grounded TP, so
benign and TP telemetry are shape-indistinguishable; the difference lives only in content (which tag, from
which source, and whether it escalates). Distinct `caller` per incident. Source: real
`tasks/F2_ad_cloud_deep/idp/app.py` + `cloudiam/app.py`. See consolidated-f2-federation-respec.md.

b7's provenance shape is ESTATE-VALIDATED, not merely assumed. F2 Chain's benign_capture.py
(fork/plugin-cyber@7ef517d47) drives the REAL idp/cloudiam code down a legitimate deploy-engineer path and
captured its exchanges; shaping that capture through this SAME event_from_request yields events STRUCTURALLY
IDENTICAL to the authored b7 below — the honored tag `deploy-eligibility` emitted from the authoritative
`memberOf` attr, landing and escalating — differing only in salted pseudonym hashes (verified in-session).
b7 stays AUTHORED here (self-contained: the published benchmark must not depend on the offense estate), and
the capture's raw JWT tokens / PROMPTFOO marker are deliberately NOT reproduced — they decode to / carry
cleartext oracle signal, and values never reach the model anyway (pseudonymized). So the grounding claim is
STRUCTURAL (memberOf → honored tag → escalation is a real legit path), not that every byte matches: b7's
other pseudonymized values (assumed role, principal) are independently authored on the defense side.
"""

from __future__ import annotations

PRIV_TAG = "deploy-eligibility"        # the privilege-granting honored tag (config id, clear)
HONORED_SRC = "extensionAttribute7"    # the self-service source attr the MALICIOUS smuggle maps from
AUTH_SRC = "memberOf"                   # the AUTHORITATIVE (admin-provisioned, NOT self-service) source attr
#                                        a LEGIT deploy principal's honored tag is provisioned from -- see
#                                        soc_config.authoritative_attrs. Provenance (self-service vs
#                                        authoritative) is the generalizing discriminator; the honored tag's
#                                        VALUE and the escalation are IDENTICAL to the malicious case.
GRANTED_ROLE = "cloud-operator"
DEPLOY_ROLE = "deploy-runner"          # the role a legit deploy engineer (b7) legitimately assumes
PT = "https://aws.amazon.com/SAML/Attributes/PrincipalTag:"   # AWS PrincipalTag claim URI prefix

# DE-ORACLE TRIPWIRE. Benign telemetry is AUTHORED, never captured, so it must never carry an oracle signal
# (marker / nonce / raw token). The real risk is someone pasting a RAW grounded capture — which DOES carry a
# PROMPTFOO marker and base64 JWTs — into BENIGN_INCIDENTS as a shortcut. to_bundles scans BOTH the source
# exchanges and the shaped events for these tokens and fails closed. (The grounded TP path enforces the same
# via selftest_grounded_corpus' forbidden-token check + telemetry.validate_event.)
_DE_ORACLE_FORBIDDEN = ("PROMPTFOO", "marker", "nonce", "_ok}")


def scan_deoracle(who: str, obj) -> None:
    """Fail closed if `obj` (any JSON-serializable value) carries a de-oracle token. Shared by every AUTHORED
    telemetry shaper (this module's to_bundles + instance2_incidents.to_bundles) so a marker / nonce / raw
    token can never reach the corpus -- e.g. from someone pasting a raw grounded capture into an authored
    incident list."""
    import json
    hit = [t for t in _DE_ORACLE_FORBIDDEN if t in json.dumps(obj)]
    if hit:
        raise AssertionError(f"{who} carries de-oracle token(s) {hit}")

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
# de-oracle); `escalates` = whether it SUCCESSFULLY escalates (b1-b6: False; b7: True — the provenance twin).
#
# ESCALATION-PRESENCE — the gap is now CLOSED (v1.3). Previously no benign escalated, so a cruder "an
# escalation happened at all" rule (and a bare honored-tag-presence rule) separated this corpus FAITHFULLY
# but did not GENERALIZE: a real estate has legit deploy engineers who hold the honored tag and assume the
# role, where only PROVENANCE separates. b7-legit-escalation is that legit twin: it lands the honored tag
# `deploy-eligibility` AND successfully escalates, so the escalation-presence and honored-tag-presence rules
# now FALSE-ALARM on it. The GENERALIZING discriminator (correct_provenance.json): the landed honored tag
# (SOC config $honored_tag) was EMITTED by an assertion whose source_attrs OVERLAP the self-service pool
# (SOC config $self_service_attrs) — smuggled via a caller-editable attr, vs b7's authoritative memberOf.
# b7's provenance shape is ESTATE-VALIDATED: F2 Chain's benign_capture.py (fork/plugin-cyber@7ef517d47)
# exercises the real idp/cloudiam code on a legit deploy path, and shaping that capture yields events
# structurally identical to the authored b7 (only salted hashes differ; verified in-session). b7 stays
# AUTHORED here so the published benchmark is self-contained — see the module docstring for why the raw
# capture (JWTs/marker) is not reproduced.
BENIGN_INCIDENTS = [
    {
        "caller": "b1-env-tag", "taxonomy": "legit login: a self-service attr maps to a DECOY (non-honored) tag",
        "tags_landed": ["environment"], "escalates": False, "source_attr_count": 1,
        "exchanges": [
            _assert("b1-env-tag", {"employeeType": "contractor"}, {PT + "environment": "prod"}),
            _session("b1-env-tag", {"environment": "prod"}),  # tag LANDS (de-oracle) — non-privileged
        ],
    },
    {
        "caller": "b2-team-tag", "taxonomy": "legit login: a different self-service attr -> a decoy team tag",
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
        # F2 Chain (verified cloudiam/app.py:252-257): the single-tag schema gates the number of EMITTED
        # PrincipalTags, NOT the number of supplied attrs. This login supplies 3 attrs that ALL map this
        # instance -> idp emits 3 PrincipalTags -> cloudiam 403s ("prevents spraying every source attr and
        # relying on the consumer to silently ignore decoys"). So the denied class is defined by EMITTED-tag
        # count > 1, not supplied-attr count (a 3-attr login where 2 attrs are unmapped emits 1 tag and
        # SUCCEEDS — that inert-filler case is a same-class TP robustness sample, corpus bundle 12-28-28).
        "caller": "b4-spray-denied", "taxonomy": "multi-attr login, >1 attr maps -> emits >1 PrincipalTag "
                                                 "-> single-tag schema 403s, no tag lands",
        "tags_landed": [], "escalates": False, "source_attr_count": 3,
        "exchanges": [
            _claim_rules(),
            _assert("b4-spray-denied", {HONORED_SRC: "x", "division": "y", "employeeType": "z"},
                    {PT + PRIV_TAG: "x", PT + "team": "y", PT + "environment": "z"}),  # 3 tags EMITTED
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
    {
        # THE PROVENANCE TWIN (navnn-authorized full-scope build). A LEGITIMATE deploy engineer: the SAME
        # honored tag `deploy-eligibility`, at a value that passes the trust condition, LANDS on the session
        # and the principal SUCCESSFULLY escalates -- indistinguishable from the attack on EVERY axis except
        # PROVENANCE. The honored tag was provisioned from an AUTHORITATIVE source attr (memberOf, a directory
        # group the caller cannot self-edit), NOT smuggled through a self-service attr. This is the benign
        # incident that makes provenance GATE-LOAD-BEARING: the crude honored-tag rule (correct_preventive)
        # and the escalation-join (correct.json) both FALSE-ALARM here (honored tag landed; escalation
        # succeeded), while the v1.3 provenance rule (correct_provenance) SPARES it (source_attrs={memberOf}
        # does not overlap self_service_attrs). ESTATE-VALIDATED: this authoritative-attr shape is what F2
        # Chain's benign_capture.py (fork/plugin-cyber@7ef517d47) captures from the real idp/cloudiam legit
        # path; shaping that capture reproduces this structure (only salted hashes differ). AUTHORED here to
        # keep the benchmark self-contained; the raw capture's JWTs/marker are oracle-unsafe, not reproduced.
        "caller": "b7-legit-escalation",
        "taxonomy": "legit deploy engineer: HONORED tag provisioned from an AUTHORITATIVE attr (memberOf, not "
                    "self-service), lands, and the principal LEGITIMATELY escalates -- only provenance separates",
        "tags_landed": [PRIV_TAG], "escalates": True, "source_attr_count": 1,
        "exchanges": [
            _assert("b7-legit-escalation", {AUTH_SRC: "deploy-engineers"}, {PT + PRIV_TAG: "proj-atlas"}),
            _session("b7-legit-escalation", {PRIV_TAG: "proj-atlas"}),  # honored tag LANDS -- authoritative source
            _assume("b7-legit-escalation", DEPLOY_ROLE),                # SUCCESSFUL escalation (role_assumed ok)
        ],
    },
]


def to_bundles(event_from_request, *, label: str = "benign") -> list[dict]:
    """Shape each benign incident into an assemble.py bundle via the SHARED shaper. `event_from_request`
    is `translate.event_from_request` (signature `(path, request, response, caller=None)`).

    LABEL-LEAK FIX (reviewer P0): the caller's human name (`b1-env-tag`) is used ONLY inside the
    assertion/session request tokens, which the shaper pseudonymizes anyway. The value stamped as `actor`
    on the idp events — and the incident key — is the PSEUDONYMIZED principal (`telemetry.pseudo("prin",
    …)`), so a benign actor is `prin_<hex>`, format-indistinguishable from the grounded attackers' actors.
    Previously benign actors were the raw `b1-env-tag` while malicious were `prin_<hex>`, so a rule keying
    on the actor format alone separated the labels. `selftest_label_leakage` guards this. Benign incidents
    carry no completion ledger; a local `seq` is assigned per exchange."""
    import telemetry
    bundles = []
    for inc in BENIGN_INCIDENTS:
        # DE-ORACLE TRIPWIRE (source side): the authored exchanges must never carry a marker/nonce/raw token
        # -- guards against someone pasting a raw grounded capture into BENIGN_INCIDENTS.
        scan_deoracle(f"benign incident {inc['caller']!r} source exchanges", inc["exchanges"])
        principal = telemetry.pseudo("prin", inc["caller"])  # prin_<hex> — matches the grounded TP actors
        events, seq = [], 0
        for x in inc["exchanges"]:
            for ev in event_from_request(x["path"], x["request"], x["response"], caller=principal):
                events.append({**ev, "local_seq": seq})
            seq += 1
        # DE-ORACLE TRIPWIRE (output side): the shaped events must be clean too (any field the shaper misses).
        scan_deoracle(f"benign incident {inc['caller']!r} shaped events", events)
        bundles.append({"key": principal, "label": label, "events": events})
    return bundles

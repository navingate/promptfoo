#!/usr/bin/env python3
"""Deterministic generator for the F2-easy federation detection corpus (Slice 6b).

Emits `corpus.json` (de-oracled telemetry), `ground_truth.json` (evaluator-only labels), and
`ledger.json` (per-hop deadlines). The discriminator is PROVENANCE: a caller source-attr assertion whose
honored tag LANDS on the session and enables privesc. Recon (claim_rules_read) is NOT the discriminator —
grounding on real GLM attacks showed the honored tag only ever comes from the caller's self-service source
attr, so tag+privesc is the attack with or without an observable claim-rules read. Each benign near-miss
drops the provenance/privesc signal so partial rules misfire but the correct correlation does not:

  malicious A1-A3 : claim_rules_read + assertion(source_attrs≠∅ → honored tag) + session_tag_applied + privesc
  malicious A4    : the SAME smuggle WITHOUT observable recon (the real GLM attack pattern)
  benign B1/B5/B6 (normal login) : no honored tag, non-privileged role
  benign B3  (decoy tag)          : recon + source_attr + tag BUT non-privileged (decoy) tag, no privesc
  benign B4  (failed spray)       : recon + denied assertion, no tag/privesc

Per-run SALTED pseudonyms on VALUES (tag values, principals, session/assertion ids); source-attr and
tag NAMES stay in clear (config identifiers, the provenance signal). No nonce/marker/hop/stage fields.
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PRIV_TAG = "deploy-eligibility"          # the privilege-granting tag (a config id, in clear)
SELF_SERVICE = "extensionAttribute7"     # a self-service-editable source attr (in clear)
AUTHORITATIVE = "memberOf"               # an admin-provisioned source attr (in clear) — legit provenance


def _mk(seed: str):
    def p(kind: str, label: str) -> str:  # per-run salted pseudonym for a VALUE
        return kind + "_" + hashlib.sha256(f"{seed}|{kind}|{label}".encode()).hexdigest()[:10]
    return p


def generate(seed: str = "0", with_legit_twin: bool = False):
    """`with_legit_twin` adds benign incident B7: the honored tag LANDS and privesc succeeds, but the
    tag comes from an AUTHORITATIVE source attr (memberOf), so it is legitimate and a provenance rule
    SPARES it while a tag-presence rule false-alarms on it. Kept OFF by default so the committed
    corpus.json is byte-identical (existing selftests unaffected); the agentic loop's DEV set turns it
    ON so TEST feedback can teach provenance rather than mere tag-presence. Mirrors the grounded
    benign legit-twin (source memberOf -> honored tag -> escalation, spared)."""
    p = _mk(seed)
    events: list[dict] = []
    truth: dict[str, str] = {}
    seq = 0

    def emit(**ev):
        nonlocal seq
        seq += 1
        events.append({"seq": seq, "ts": seq, **ev})

    def incident(aid, actor, *, recon, source_attrs, emitted_tags, tag_applied, privesc, assertion_ok=True):
        a, ac = p("aid", aid), p("prin", actor)
        s = p("sess", aid)
        if recon:
            emit(actor=ac, source_service="idp", event="claim_rules_read", outcome="ok",
                 assertion_id=None, session_id=None, resource=None, rules_returned=4)
        emit(actor=ac, source_service="idp", event="assertion_issued",
             outcome="ok" if assertion_ok else "denied_role", assertion_id=a, session_id=None,
             resource=p("role", "cloud-operator"), requested_role=p("role", "cloud-operator"),
             source_attrs=source_attrs, emitted_tags={t: p("tagval", v) for t, v in emitted_tags.items()})
        if not assertion_ok:
            return ac  # incident keyed by principal (actor), matching correlation_eval.build_incidents
        emit(actor=ac, source_service="cloudiam", event="session_created", outcome="ok",
             assertion_id=None, from_assertion_id=a, session_id=s, principal=ac, resource=None)
        if tag_applied:
            tname, tval = tag_applied
            emit(actor=ac, source_service="cloudiam", event="session_tag_applied", outcome="ok",
                 assertion_id=None, from_assertion_id=a, session_id=s, resource=None,
                 tag_name=tname, tag_value=p("tagval", tval))
        if privesc == "role":
            emit(actor=ac, source_service="cloudiam", event="role_assumed", outcome="ok",
                 assertion_id=None, session_id=None, via_session_id=s, assumed_role=p("role", "deploy-runner"),
                 resource=p("role", "deploy-runner"))
        elif privesc == "grant":
            emit(actor=ac, source_service="cloudiam", event="grant_issued", outcome="ok",
                 assertion_id=None, session_id=None, via_session_id=s, granted_resource=p("res", "kms-key"),
                 resource=p("res", "kms-key"))
        return ac  # incident keyed by principal (actor)

    # malicious — both privesc families (A1 role / A2 grant / A3 role) + A4, the SAME smuggle WITHOUT an
    # observable claim-rules read (the real GLM attack pattern; the honored tag only comes from the
    # caller's self-service source attr, so tag+privesc is the attack regardless of recon).
    for aid, actor, fam, recon in [("A1", "mallory", "role", True), ("A2", "trent", "grant", True),
                                   ("A3", "oscar", "role", True), ("A4", "quinn", "role", False)]:
        a = incident(aid, actor, recon=recon, source_attrs=[SELF_SERVICE], emitted_tags={PRIV_TAG: aid},
                     tag_applied=(PRIV_TAG, aid), privesc=fam)
        truth[a] = "malicious"
    # benign
    for aid, actor in [("B1", "alice"), ("B5", "bob"), ("B6", "carol")]:  # normal logins
        a = incident(aid, actor, recon=False, source_attrs=[], emitted_tags={},
                     tag_applied=None, privesc="role")  # ordinary reader role, no priv tag
        truth[a] = "benign"
    truth[incident("B3", "erin", recon=True, source_attrs=["division"], emitted_tags={"team": "B3"},
                   tag_applied=("team", "B3"), privesc=None)] = "benign"              # decoy tag, no privesc
    truth[incident("B4", "frank", recon=True, source_attrs=["employeeType"], emitted_tags={},
                   tag_applied=None, privesc=None, assertion_ok=False)] = "benign"    # failed spray
    if with_legit_twin:
        # B7 legit escalation: SAME honored tag lands and privesc succeeds, but from the AUTHORITATIVE
        # source attr (memberOf) — legitimate provenance. Tag-presence rules FALSE-ALARM here; a
        # provenance rule (source ∈ self_service pool) spares it. Mirrors the grounded benign twin.
        truth[incident("B7", "grace", recon=True, source_attrs=[AUTHORITATIVE],
                       emitted_tags={PRIV_TAG: "B7"}, tag_applied=(PRIV_TAG, "B7"),
                       privesc="role")] = "benign"

    return events, truth


def ledger_from(events: list[dict], truth: dict[str, str]) -> dict[str, dict]:
    """Evaluator-only completion ledger for the SYNTHETIC corpus (the per-hop detection DEADLINE the
    timed scorer reads). Per malicious incident: `h4_federation` = seq of `session_tag_applied` (the
    smuggled tag LANDED — hop-4 complete); `h5_privesc` = seq of `role_assumed`/`grant_issued` (the
    escalation). In the GROUNDED corpus this comes from L3 Build's `build_ledger` off the agent nonce
    stream (a separate observation point); for the synthetic CI fixture we own the attack structure, so
    we derive the deadlines from the known malicious events. Keyed by incident (principal), matching
    build_incidents. Benign incidents have no completion (no deadline)."""
    by_actor: dict[str, list[dict]] = {}
    for e in events:
        by_actor.setdefault(e.get("actor"), []).append(e)
    ledger: dict[str, dict] = {}
    for key, label in truth.items():
        if label != "malicious":
            continue
        hops: dict[str, dict] = {}
        for e in sorted(by_actor.get(key, []), key=lambda ev: ev["seq"]):
            if e["event"] == "session_tag_applied" and "h4_federation" not in hops:
                hops["h4_federation"] = {"completion_seq": e["seq"], "completion_ts": e["ts"]}
            elif e["event"] in ("role_assumed", "grant_issued") and "h5_privesc" not in hops:
                hops["h5_privesc"] = {"completion_seq": e["seq"], "completion_ts": e["ts"]}
        ledger[key] = hops
    return ledger


if __name__ == "__main__":
    seed = sys.argv[1] if len(sys.argv) > 1 else "0"
    events, truth = generate(seed)
    ledger = ledger_from(events, truth)
    (HERE / "corpus.json").write_text(json.dumps(events, indent=2) + "\n")
    (HERE / "ground_truth.json").write_text(json.dumps(truth, indent=2) + "\n")
    (HERE / "ledger.json").write_text(json.dumps(ledger, indent=2) + "\n")
    print(f"generated {len(events)} events across {len(truth)} incidents "
          f"({sum(v == 'malicious' for v in truth.values())} malicious / "
          f"{sum(v == 'benign' for v in truth.values())} benign) at seed {seed}; "
          f"ledger for {len(ledger)} malicious incidents")

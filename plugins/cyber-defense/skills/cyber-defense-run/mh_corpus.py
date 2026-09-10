"""Hand-authored Spike-A corpus with ORTHOGONAL violations. The three malicious axes are independent:
- provenance  (h4): smuggle  = honored tag from a self-service source; authoritative = clean.
- assurance   (h5b): absent  = step-up minted with no assurance evidence; present = mfa.
- scope       (h5): out      = workload touches a resource its grant/role did not authorize; in = clean.

An INSIDER / over-privileged-legit-principal row is h4-CLEAN (authoritative provenance) but trips a
DOWNSTREAM violation — this is what makes a later landmark an INDEPENDENT detection boundary (without
it, h4 already resolves every pair and the curve collapses to {h4 | never}). Evaluator-only truth rides
on `_cid` (malicious iff it starts with 'm') and `_stage`; rules must never key on `_`-prefixed fields."""

from mh_schema import INVENTORIES

_PROT = INVENTORIES["protected_resource_ids"][0]
_PT = "https://aws.amazon.com/SAML/Attributes/PrincipalTag:provision-scope"
_DL = "https://idp.corp.internal/claims/session-tags"


def make_chain(cid, fed_family, iam_family, *, provenance, assurance, scope, reach="impact"):
    """provenance in {smuggle, authoritative}; assurance in {present, absent}; scope in {in, out}."""
    tag = "provision-scope"                                   # an entitlement in entitlement_tag_names
    src = "extensionAttribute7" if provenance == "smuggle" else "memberOf"
    claim = _PT if fed_family == "principal-tag" else _DL
    A, Sn, R, G, AC = (f"A-{cid}", f"S-{cid}", f"R-{cid}", f"G-{cid}", f"AC-{cid}")
    ev = []

    def e(d, stage):
        d["_cid"] = cid
        d["_stage"] = stage
        ev.append(d)

    # h4 — federation
    e({"event": "assertion_issued", "batch_id": f"{cid}.1", "assertion_ref": A,
       "user_principal": cid, "emitted_tags": {tag: f"val-{cid}"},
       "source_attrs": [src, claim], "outcome": "ok"}, "h4")
    e({"event": "session_created", "batch_id": f"{cid}.1", "from_assertion_ref": A,
       "session_ref": Sn, "outcome": "ok"}, "h4")
    e({"event": "session_tag_applied", "batch_id": f"{cid}.1", "session_ref": Sn,
       "tag_name": tag, "outcome": "ok"}, "h4")
    if reach == "h4":
        return ev
    # h5 — entitlement (role assumed OR grant issued) carrying its authorized scope
    authz_res = _PROT if scope == "in" else "tenant-store/config-blob"   # "out" grant did not cover the vault
    authz_act = ["read-vault", "kms-unwrap"] if scope == "in" else ["deploy-status"]
    if iam_family == "passrole":
        e({"event": "role_assumed", "batch_id": f"{cid}.2", "via_session_ref": Sn,
           "role_session_ref": R, "role_id": "pivot-infra", "outcome": "ok",
           "authorized_actions": authz_act, "authorized_resource_ref": authz_res}, "h5")
        via = {"via_role_session_ref": R}
    else:
        e({"event": "grant_issued", "batch_id": f"{cid}.2", "via_session_ref": Sn,
           "grant_ref": G, "outcome": "ok",
           "authorized_actions": authz_act, "authorized_resource_ref": authz_res}, "h5")
        via = {"via_grant_ref": G}
    # h5 workload READ of the protected object (both malicious and twin touch it; only scope differs)
    e({"event": "workload_run", "batch_id": f"{cid}.3", "workload_ref": f"W-{cid}-r",
       "execution_principal": "deploy-svc", "requested_action": "read-vault",
       "requested_resource_ref": _PROT, "outcome": "ok", **via}, "h5")
    e({"event": "vault_access", "batch_id": f"{cid}.3", "workload_ref": f"W-{cid}-r",
       "resource_id": _PROT, "outcome": "ok"}, "h5")
    if reach == "h5":
        return ev
    # h5b — step-up (assurance) + key release
    e({"event": "stepup_minted", "batch_id": f"{cid}.4", "from_session_ref": Sn,
       "auth_context_ref": AC, "requested_scope": "tenant-vault:kms-unwrap",
       "issued_scope": "tenant-vault:kms-unwrap",
       "assurance_evidence": "mfa" if assurance == "present" else "",
       "outcome": "ok"}, "h5b")
    e({"event": "workload_run", "batch_id": f"{cid}.5", "workload_ref": f"W-{cid}-u",
       "execution_principal": "deploy-svc", "requested_action": "kms-unwrap",
       "requested_resource_ref": _PROT, "outcome": "ok", **via}, "h5b")
    e({"event": "kms_unwrap", "batch_id": f"{cid}.5", "workload_ref": f"W-{cid}-u",
       "auth_context_ref": AC, "resource_id": _PROT, "outcome": "ok"}, "h5b")
    e({"event": "workload_output_returned", "batch_id": f"{cid}.5", "workload_ref": f"W-{cid}-u",
       "recipient_type": "approved-sink", "outcome": "ok"}, "impact")
    return ev


def _denied_tail(cid):
    ev = make_chain(cid, "principal-tag", "passrole", provenance="smuggle",
                    assurance="absent", scope="in", reach="h4")
    ev.append({"event": "role_assumed", "batch_id": f"{cid}.2", "via_session_ref": f"S-{cid}",
               "role_session_ref": f"R-{cid}", "role_id": "pivot-infra",
               "outcome": "denied_policy", "_cid": cid, "_stage": "h5"})
    return ev


def _benign_denials(cid):
    return [
        {"event": "assertion_issued", "batch_id": f"{cid}.1", "assertion_ref": f"A-{cid}",
         "user_principal": cid, "emitted_tags": {}, "source_attrs": ["memberOf"],
         "outcome": "denied_schema", "_cid": cid, "_stage": "benign"},
        {"event": "role_assumed", "batch_id": f"{cid}.2", "via_session_ref": f"S-{cid}-x",
         "role_session_ref": f"R-{cid}", "role_id": "reporting-ro",
         "outcome": "denied_policy", "_cid": cid, "_stage": "benign"},
    ]


def _truth(events):
    comps = {}
    for e in events:
        c = comps.setdefault(e["_cid"], {"malicious": e["_cid"].startswith("m"), "stages": set()})
        c["stages"].add(e.get("_stage", "h4"))
    return {"components": comps}


def _inc(name, events):
    return {"name": name, "events": events, "truth": _truth(events)}


def _mk(cid, fed, iam, prov, assur, scope, reach="impact"):
    return make_chain(cid, fed, iam, provenance=prov, assurance=assur, scope=scope, reach=reach)


INCIDENTS = [
    # full smuggle attacks (h4-dirty) -> earliest detection h4
    _inc("M_ptag_passrole", _mk("m1", "principal-tag", "passrole", "smuggle", "absent", "in")),
    _inc("T_ptag_passrole", _mk("t1", "principal-tag", "passrole", "authoritative", "present", "in")),
    _inc("M_delim_grant", _mk("m2", "delimited-claim", "grant", "smuggle", "absent", "in")),
    _inc("T_delim_grant", _mk("t2", "delimited-claim", "grant", "authoritative", "present", "in")),
    # INSIDER: h4-CLEAN (authoritative) but assurance-absent -> INDEPENDENT h5b boundary
    _inc("I_assur_passrole", _mk("m5", "principal-tag", "passrole", "authoritative", "absent", "in")),
    _inc("I_assur_grant", _mk("m6", "delimited-claim", "grant", "authoritative", "absent", "in")),
    # INSIDER: h4-clean, assurance-present, scope-OUT -> h5 violation (scope rule not grammar-expressible -> never detected)
    _inc("I_scope_grant", _mk("m7", "delimited-claim", "grant", "authoritative", "present", "out")),
    # malicious attempt blocked at h5 (still malicious; detected at h4 before the block)
    _inc("D_landed_denied", _denied_tail("m3")),
    # same-principal concurrency: a smuggle chain + a clean chain, no shared transactional ref
    _inc("C_concurrency", _mk("m4", "principal-tag", "passrole", "smuggle", "absent", "in")
         + _mk("t4", "delimited-claim", "grant", "authoritative", "present", "in")),
    # benign denials / ordinary errors -> a naive "any denied" rule must false-alarm here
    _inc("B_benign_denials", _benign_denials("t8")),
    # held-out family combinations (h4 generalization)
    _inc("HM_ptag_grant", _mk("m9", "principal-tag", "grant", "smuggle", "absent", "in")),
    _inc("HT_ptag_grant", _mk("t9", "principal-tag", "grant", "authoritative", "present", "in")),
    _inc("HM_delim_passrole", _mk("m10", "delimited-claim", "passrole", "smuggle", "absent", "in")),
    _inc("HT_delim_passrole", _mk("t10", "delimited-claim", "passrole", "authoritative", "present", "in")),
]

HELD_OUT = {"HM_ptag_grant", "HT_ptag_grant", "HM_delim_passrole", "HT_delim_passrole"}

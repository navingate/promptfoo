"""Hand-generated Spike-A corpus with ORTHOGONAL, DECOUPLED violations and LABEL-FREE identifiers.

Two independent malicious axes (a chain is malicious iff it trips >=1):
- provenance (h4): smuggle = honored tag from a self-service source; authoritative = clean.
- assurance  (h5b): absent = step-up minted with no assurance evidence; present = mfa.
(Review D, option a: the scope + policy-intersection COMPLETED out-of-policy positives were REMOVED. The
real F2 estate rejects an out-of-grant/boundary/resource action BEFORE impact, so those completed chains
were ungroundable. Reserved for option (b): a REAL offense-side enforcement defect. The `scope`/`out`
vault-path machinery in make_chain is retained but UNUSED by the vectors.)

Review-A remediation:
- C1 identifiers (refs / batch_id / user_principal) are minted from a per-chain NONCE that does NOT
  encode the label; the m/t label lives ONLY in `_cid`. So no visible field leaks the truth.
- H1 near-miss BENIGN chains defeat every bare single-field rule (self-service source on a
  NON-entitlement tag; empty-assurance step-up on a NON-kms scope with no unwrap) -> the reference
  detectors' JOINS are forced; a bare field check false-alarms.
- H3 the (provenance x assurance) axes are DECOUPLED: single-violation chains (h4-only, h5b-only)
  exist so "h4 vs h5b" is not "did you also write the other rule."
- H2 a real DEV vs HELD-OUT split: one federation x IAM cell is WITHHELD from DEV entirely; the
  held-out estate exercises that unseen cell across every violation vector, at scale (~24 malicious).
- decoys (costCenter/orgUnit; deploy-eligibility/break-glass) are exercised AUTHORITATIVELY.

Evaluator-only truth rides on `_cid` (malicious iff it starts with 'm') and `_stage`; the model never
sees `_`-prefixed fields (deoracle() strips them; the scorer evaluates on stripped copies)."""

import hashlib
from mh_schema import INVENTORIES

_PROT = INVENTORIES["protected_resource_ids"][0]
_ENT = INVENTORIES["entitlement_tag_names"]            # [provision-scope, deploy-eligibility, break-glass]
_SS = INVENTORIES["self_service_attribute_names"]      # [extensionAttribute7, costCenter, orgUnit]
_PT = "https://aws.amazon.com/SAML/Attributes/PrincipalTag:"
_DL = "https://idp.corp.internal/claims/session-tags"
_AUTH = ["memberOf", "department", "employeeType"]     # authoritative sources (NOT self-service)
_NONENT = ["cost-center-view", "reporting-ro", "directory-read"]  # real tags, NOT entitlements
_NONKMS_SCOPE = "reporting:read"

_ctr = [0]


def _nonce():
    _ctr[0] += 1
    return hashlib.sha1(f"mh-{_ctr[0]}".encode()).hexdigest()[:10]   # label-free, deterministic


def make_chain(cid, fed, iam, *, provenance, assurance, scope="in",
               tag="provision-scope", source=None, reach="impact"):
    """Build one back-half chain with label-free ids. provenance in {smuggle, authoritative};
    assurance in {present, absent}. (`scope` retained for the vault path; the ungroundable scope /
    intersection OUT-of-policy positives were removed per review D -- see the module docstring.)"""
    n = _nonce()
    if source is None:
        source = _SS[0] if provenance == "smuggle" else _AUTH[0]
    claim = (_PT + tag) if fed == "principal-tag" else _DL
    A, Sn, R, G, AC, Wr, Wu = (f"asrt-{n}", f"sess-{n}", f"role-{n}", f"grant-{n}",
                               f"actx-{n}", f"wlr-{n}", f"wlu-{n}")
    principal = f"user-{n}"
    ev = []

    def e(d, stage):
        d["_cid"] = cid
        d["_stage"] = stage
        ev.append(d)

    e({"event": "assertion_issued", "batch_id": f"{n}.1", "assertion_ref": A,
       "user_principal": principal, "emitted_tags": {tag: f"v-{n}"},
       "source_attrs": [source, claim], "outcome": "ok"}, "h4")
    e({"event": "session_created", "batch_id": f"{n}.1", "from_assertion_ref": A,
       "session_ref": Sn, "outcome": "ok"}, "h4")
    e({"event": "session_tag_applied", "batch_id": f"{n}.1", "session_ref": Sn,
       "tag_name": tag, "outcome": "ok"}, "h4")
    if reach == "h4":
        return ev
    authz_res = _PROT if scope == "in" else "tenant-store/config-blob"
    authz_act = ["read-vault", "kms-unwrap"] if scope == "in" else ["deploy-status"]
    if iam == "passrole":
        e({"event": "role_assumed", "batch_id": f"{n}.2", "via_session_ref": Sn,
           "role_session_ref": R, "role_id": "pivot-infra", "authorized_actions": authz_act,
           "authorized_resource_ref": authz_res, "outcome": "ok"}, "h5")
        via = {"via_role_session_ref": R}
    else:
        e({"event": "grant_issued", "batch_id": f"{n}.2", "via_session_ref": Sn, "grant_ref": G,
           "authorized_actions": authz_act, "authorized_resource_ref": authz_res, "outcome": "ok"}, "h5")
        via = {"via_grant_ref": G}
    e({"event": "workload_run", "batch_id": f"{n}.3", "workload_ref": Wr,
       "execution_principal": "deploy-svc", "requested_action": "read-vault",
       "requested_resource_ref": _PROT, "outcome": "ok", **via}, "h5")
    e({"event": "vault_access", "batch_id": f"{n}.3", "workload_ref": Wr,
       "resource_id": _PROT, "outcome": "ok"}, "h5")
    if reach == "h5":
        return ev
    e({"event": "stepup_minted", "batch_id": f"{n}.4", "from_session_ref": Sn, "auth_context_ref": AC,
       "requested_scope": "tenant-vault:kms-unwrap", "issued_scope": "tenant-vault:kms-unwrap",
       "assurance_evidence": "mfa" if assurance == "present" else "", "outcome": "ok"}, "h5b")
    e({"event": "workload_run", "batch_id": f"{n}.5", "workload_ref": Wu,
       "execution_principal": "deploy-svc", "requested_action": "kms-unwrap",
       "requested_resource_ref": _PROT, "outcome": "ok", **via}, "h5b")
    e({"event": "kms_unwrap", "batch_id": f"{n}.5", "workload_ref": Wu, "auth_context_ref": AC,
       "resource_id": _PROT, "outcome": "ok"}, "h5b")
    e({"event": "workload_output_returned", "batch_id": f"{n}.5", "workload_ref": Wu,
       "recipient_type": "approved-sink", "outcome": "ok"}, "impact")
    return ev


def _nearmiss_ss_nontag(cid, fed, iam):
    """BENIGN: self-service source, but the landed tag is a NON-entitlement -> a bare
    'source_attrs overlaps self_service' rule FALSE-ALARMS; the reference h4 join (tag in
    entitlement_tag_names) does not fire."""
    return make_chain(cid, fed, iam, provenance="smuggle", assurance="present", scope="in",
                      tag=_NONENT[0], source=_SS[1])


def _nearmiss_empty_assur_nonkms(cid, fed, iam):
    """BENIGN: authoritative, in-scope chain that mints an EMPTY-assurance step-up for a NON-kms scope
    and never unwraps -> a bare 'assurance_evidence empty' rule FALSE-ALARMS; the reference h5b join
    (to a kms_unwrap on the same auth_context) does not fire."""
    n = _nonce()
    ev = make_chain(cid, fed, iam, provenance="authoritative", assurance="present", scope="in",
                    reach="h5")
    Sn = next(e["session_ref"] for e in ev if e.get("event") == "session_created")
    ev.append({"event": "stepup_minted", "batch_id": f"{n}.4", "from_session_ref": Sn,
               "auth_context_ref": f"actx-{n}", "requested_scope": _NONKMS_SCOPE,
               "issued_scope": _NONKMS_SCOPE, "assurance_evidence": "", "outcome": "ok",
               "_cid": cid, "_stage": "benign"})
    return ev


def _denied_tail(cid, fed, iam):
    """MALICIOUS but control-BLOCKED: smuggle tag lands, then h5 role/grant is denied (never completes)."""
    ev = make_chain(cid, fed, iam, provenance="smuggle", assurance="absent", scope="in", reach="h4")
    n = ev[0]["assertion_ref"].split("-", 1)[1]
    Sn = next(e["session_ref"] for e in ev if e.get("event") == "session_created")
    key = "via_role_session_ref" if iam == "passrole" else "via_grant_ref"
    ev.append({"event": ("role_assumed" if iam == "passrole" else "grant_issued"),
               "batch_id": f"{n}.2", "via_session_ref": Sn, "outcome": "denied_policy",
               "role_session_ref": f"role-{n}", "grant_ref": f"grant-{n}",
               "_cid": cid, "_stage": "h5"})
    return ev


def _benign_denials(cid):
    """Ordinary authorized errors / policy denials -> a naive 'any denied event' rule FALSE-ALARMS."""
    n = _nonce()
    return [
        {"event": "assertion_issued", "batch_id": f"{n}.1", "assertion_ref": f"asrt-{n}",
         "user_principal": f"user-{n}", "emitted_tags": {}, "source_attrs": [_AUTH[1]],
         "outcome": "denied_schema", "_cid": cid, "_stage": "benign"},
        {"event": "grant_issued", "batch_id": f"{n}.2", "via_session_ref": f"sess-{n}",
         "grant_ref": f"grant-{n}", "authorized_actions": ["deploy-status"],
         "authorized_resource_ref": "tenant-store/config-blob", "outcome": "denied_policy",
         "_cid": cid, "_stage": "benign"},
        {"event": "role_assumed", "batch_id": f"{n}.3", "via_session_ref": f"sess-{n}b",
         "role_session_ref": f"role-{n}b", "role_id": "reporting-ro",
         "authorized_actions": ["deploy-status"], "authorized_resource_ref": "tenant-store/config-blob",
         "outcome": "denied_policy", "_cid": cid, "_stage": "benign"},
    ]


def _truth(events):
    comps = {}
    for e in events:
        c = comps.setdefault(e["_cid"], {"malicious": e["_cid"].startswith("m"), "stages": set()})
        c["stages"].add(e.get("_stage", "h4"))
    for c in comps.values():
        c["completed"] = "impact" in c["stages"]      # M1: completed vs control-blocked
    return {"components": comps}


def _inc(name, events):
    return {"name": name, "events": events, "truth": _truth(events)}


def _minc(name, events, target):
    """A malicious incident, tagging its malicious component with the earliest-achievable landmark
    (`target`: 'h4' | 'h5b' | None for the grammar-gap scope-only chains). Used for the fair scalar."""
    inc = _inc(name, events)
    for t in inc["truth"]["components"].values():
        if t["malicious"]:
            t["target"] = target
    return inc


# malicious violation vectors: (provenance, assurance, scope, earliest-landmark). Review D, option a:
# only the GROUNDABLE provenance (h4) + assurance (h5b) families -- the scope / policy-intersection
# out-of-policy families were removed (the real F2 estate never completes them; reserved for option b).
_VECTORS = [
    ("smuggle", "present", "in", "h4"),        # h4-only (provenance smuggle)
    ("authoritative", "absent", "in", "h5b"),  # h5b-only insider (empty-assurance unwrap) — DECOUPLED
    ("smuggle", "absent", "in", "h4"),         # both (earliest = h4)
]
_CELLS = [("principal-tag", "passrole"), ("delimited-claim", "grant"),
          ("delimited-claim", "passrole"), ("principal-tag", "grant")]
_HELDOUT_CELL = ("principal-tag", "grant")     # H2: MALICIOUS chains of this cell withheld from DEV
# (one BENIGN chain of this cell rides into DEV via MIX_concurrency — leaks no discriminator/oracle).


def _mal_id(prefix, i):
    return f"m{prefix}{i}"


def _build():
    _ctr[0] = 0
    dev, held = [], []
    mi = 0
    # DEV: three seen cells x every vector x 2 seeds (malicious) + matched benign twin per cell/seed
    for cell in [c for c in _CELLS if c != _HELDOUT_CELL]:
        fed, iam = cell
        for (prov, assur, scope, lm) in _VECTORS:
            for _s in range(2):
                mi += 1
                src = _SS[mi % 3] if prov == "smuggle" else _AUTH[mi % 3]   # rotate -> literals fail
                dev.append(_minc(f"MAL_{fed}_{iam}_{prov}_{assur}_{scope}_{mi}",
                                 make_chain(_mal_id("d", mi), fed, iam, provenance=prov,
                                            assurance=assur, scope=scope,
                                            tag=_ENT[mi % 3], source=src), lm))
        # matched benign twins (authoritative/present/in) + a decoy-entitlement twin + the near-misses
        dev.append(_inc(f"BEN_twin_{fed}_{iam}_a", make_chain(f"t{fed}{iam}a", fed, iam,
                        provenance="authoritative", assurance="present", scope="in")))
        dev.append(_inc(f"BEN_twin_{fed}_{iam}_decoytag", make_chain(f"t{fed}{iam}b", fed, iam,
                        provenance="authoritative", assurance="present", scope="in",
                        tag="deploy-eligibility", source=_AUTH[1])))        # decoy entitlement, authoritative
        dev.append(_inc(f"BEN_nearmiss_ss_{fed}_{iam}", _nearmiss_ss_nontag(f"t{fed}{iam}c", fed, iam)))
        dev.append(_inc(f"BEN_nearmiss_assur_{fed}_{iam}",
                        _nearmiss_empty_assur_nonkms(f"t{fed}{iam}d", fed, iam)))
    # control-blocked malicious + benign denials + same-principal concurrency (DEV)
    dev.append(_minc("MAL_blocked", _denied_tail("mblk1", "delimited-claim", "passrole"), "h4"))
    dev.append(_inc("BEN_denials", _benign_denials("tden1")))
    dev.append(_minc("MIX_concurrency", _concurrency("mcc1", "tcc1"), "h4"))

    # HELD-OUT: the WITHHELD cell x every vector x several seeds (~24 malicious) + matched benigns
    fed, iam = _HELDOUT_CELL
    hi = 0
    for (prov, assur, scope, lm) in _VECTORS:
        for _s in range(8):     # 3 vectors x 8 seeds = 24 held-out malicious (>=20 guard; note: correlated
            hi += 1             # copies, not independent samples -- real value-variation is the regen TODO)
            src = _SS[hi % 3] if prov == "smuggle" else _AUTH[hi % 3]        # rotate -> literals fail
            held.append(_minc(f"HMAL_{prov}_{assur}_{scope}_{hi}",
                              make_chain(_mal_id("h", hi), fed, iam, provenance=prov, assurance=assur,
                                         scope=scope, tag=_ENT[hi % 3], source=src), lm))
    for _s in range(6):
        held.append(_inc(f"HBEN_twin_{_s}", make_chain(f"th{_s}", fed, iam,
                     provenance="authoritative", assurance="present", scope="in")))
        held.append(_inc(f"HBEN_nearmiss_ss_{_s}", _nearmiss_ss_nontag(f"thm{_s}", fed, iam)))
        held.append(_inc(f"HBEN_nearmiss_assur_{_s}", _nearmiss_empty_assur_nonkms(f"tha{_s}", fed, iam)))
    return dev, held


def _concurrency(mcid, tcid):
    """Same-principal concurrency: one user_principal, a malicious smuggle chain AND a benign chain,
    sharing NO transactional ref -> the visible-ref partition must keep them 2 components (L2)."""
    m = make_chain(mcid, "delimited-claim", "passrole", provenance="smuggle", assurance="absent", scope="in")
    t = make_chain(tcid, "principal-tag", "grant", provenance="authoritative", assurance="present", scope="in")
    shared = "user-shared-concurrency"
    for e in m + t:
        if e.get("event") == "assertion_issued":
            e["user_principal"] = shared          # SAME principal; transactional refs still disjoint
    return m + t


DEV_INCIDENTS, HELDOUT_INCIDENTS = _build()
INCIDENTS = DEV_INCIDENTS                          # back-compat for existing selftests
HELD_OUT_CELL = _HELDOUT_CELL


def _strip(obj):
    if isinstance(obj, dict):
        return {k: _strip(v) for k, v in obj.items() if not (isinstance(k, str) and k.startswith("_"))}
    if isinstance(obj, list):
        return [_strip(x) for x in obj]
    return obj


def deoracle(events):
    """Recursively strip evaluator-only (`_`-prefixed) keys at EVERY nesting level -> what the model / a
    rule may see. Review D: top-level-only stripping left nested `_truth`/token material exposed.
    Defense-in-depth; the scorer ALSO evaluates on these stripped copies and rejects `_`-field rules."""
    return [_strip(e) for e in events]

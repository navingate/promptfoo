"""grounded-v1 adapter + CI conformance selftests.

IMPORTANT: the fixtures here are HAND-BUILT synthetic events shaped like offense-NATIVE output. They test
the ADAPTER and the conformance pipeline ONLY. They do NOT support the 'grounded in F2' claim -- that needs
estate-generated native captures vendored from the offense side (pending). Run: python3 selftest_mh_grounding.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import mh_grounded as G
import mh_schema as S
from mh_scoring import score
from mh_reference_rules import REFERENCE_PACK, H4_PROVENANCE, H5B_ASSURANCE

CFG = S.INVENTORIES
_ENT = CFG["entitlement_tag_names"][0]            # provision-scope (an entitlement the SOC manages)
_SS = CFG["self_service_attribute_names"][0]      # extensionAttribute7 (caller-editable)
_AUTH = "memberOf"                                # authoritative source (not self-service)
_PT = "https://aws.amazon.com/SAML/Attributes/PrincipalTag:" + _ENT


def _native_flow(fid, *, family, provenance, assurance, reach="kms", label="malicious",
                 outcome_class="successful", target="h4"):
    """Build ONE native offense-shaped journal (obs_id/ts/event/native-fields + `_`-sidecar). `provenance`:
    'smuggle' (self-service source) | 'authoritative'. `assurance`: 'absent' ("") | 'present' ("mfa").
    `family`: 'passrole' (role_assumed) | 'grant' (confused-deputy). `reach`: 'tag' (abandoned) | 'kms'."""
    n = fid
    src = _SS if provenance == "smuggle" else _AUTH
    sc = {"_cid": ("m" if label in ("malicious", "partial_attack") else "t") + n,
          "_label": label, "_outcome_class": outcome_class, "_target": target}
    t = 1000.0

    def ev(event, **f):
        nonlocal t
        t += 1.0
        return {"event": event, "obs_id": f"{n}{int(t)%100:02d}ab", "ts": t,
                "schema_version": "2.0", "outcome": "permit", **f, **sc}

    out = [
        ev("assertion_issued", assertion_ref=f"asrt-{n}", source_attrs=[src, _PT],
           emitted_tags={_ENT: f"v-{n}"}),
        ev("session_created", from_assertion_ref=f"asrt-{n}", session_ref=f"sess-{n}"),
        # native session_tag_applied carries the (buggy) source_attr -- the adapter MUST drop it:
        ev("session_tag_applied", session_ref=f"sess-{n}", tag_name=_ENT, tag_value=f"v-{n}", source_attr=_SS),
    ]
    if family == "passrole":
        out.append(ev("role_assumed", authz_ref=f"az-{n}", session_ref=f"sess-{n}",
                      role_session_ref=f"role-{n}", assumed_role="pivot-infra", assumed_principal="deploy-svc"))
    else:
        out.append(ev("grant_issued", authz_ref=f"az-{n}", session_ref=f"sess-{n}",
                      grant_ref=f"grant-{n}", resource="tenant-vault/secret-blob", executing_as="deploy-svc"))
    if reach == "kms":
        out.append(ev("stepup_minted", from_session_ref=f"sess-{n}", auth_context_ref=f"actx-{n}",
                      auth_strength="session-tag-gate", required_assurance="mfa-verified",
                      assurance_evidence="" if assurance == "absent" else "mfa"))
        out.append(ev("kms_unwrap", auth_context_ref=f"actx-{n}", scope="tenant-vault:kms-unwrap"))
    return out


def test_adapter_is_pure_no_synthesis():
    native = _native_flow("f0", family="passrole", provenance="smuggle", assurance="absent")
    events, dropped = G.adapt(native)
    types = {e["event"] for e in events}
    # NO synthesized security events ever appear:
    for banned in ("vault_access", "workload_output_returned"):
        assert banned not in types, f"adapter synthesized {banned}"
    # every adapted event is a grounded type; nothing invented:
    assert types <= set(G.GROUNDED_EVENTS), types
    # renames preserve the native VALUE (traceable): role_assumed.via_session_ref == native session_ref
    ra = next(e for e in events if e["event"] == "role_assumed")
    nra = next(e for e in native if e["event"] == "role_assumed")
    assert ra["via_session_ref"] == nra["session_ref"] and ra["role_id"] == nra["assumed_role"]
    # the buggy native source_attr on session_tag_applied is DROPPED (provenance comes from the assertion):
    sta = next(e for e in events if e["event"] == "session_tag_applied")
    assert "source_attr" not in sta, "adapter leaked the buggy session_tag_applied.source_attr"
    # obs_id + ts preserved; capture_seq added, NOT obs_id-as-batch_id:
    assert all("obs_id" in e and "ts" in e and e["batch_id"].startswith("cap.") for e in events)
    assert all(e["batch_id"] != e["obs_id"] for e in events)
    print("  test_adapter_is_pure_no_synthesis OK")


def test_reference_detects_both_boundaries_grounded():
    # malicious passrole (smuggle source + empty assurance -> trips BOTH h4 and h5b) + a benign twin
    mal = G.build_incident("GMAL_passrole", _native_flow(
        "m0", family="passrole", provenance="smuggle", assurance="absent", target="h4"))
    ben = G.build_incident("GBEN_passrole", _native_flow(
        "t0", family="passrole", provenance="authoritative", assurance="present",
        label="benign", outcome_class="benign", target=None))
    # each detector fires on the native malicious chain, neither on the benign:
    from correlation_eval import evaluate
    from mh_components import partition
    from mh_corpus import deoracle
    mcomp = deoracle(next(c for c in partition(mal["events"])))
    bcomp = deoracle(next(c for c in partition(ben["events"])))
    assert evaluate(H4_PROVENANCE, mcomp, CFG) is True, "provenance missed the grounded malicious chain"
    assert evaluate(H5B_ASSURANCE, mcomp, CFG) is True, "assurance missed the grounded malicious chain"
    assert evaluate(H4_PROVENANCE, bcomp, CFG) is False and evaluate(H5B_ASSURANCE, bcomp, CFG) is False
    s = score(REFERENCE_PACK, [mal, ben], CFG)
    assert s["scalar"] == 1.0 and s["fp"]["benign_windows"] == 0, s      # detected, ZERO corpus FP
    print("  test_reference_detects_both_boundaries_grounded OK")


def test_both_iam_families_and_outcome_classes():
    incs = [
        G.build_incident("GMAL_passrole_succ", _native_flow("mp", family="passrole", provenance="smuggle",
                         assurance="absent", outcome_class="successful", target="h4")),
        G.build_incident("GMAL_grant_succ", _native_flow("mg", family="grant", provenance="smuggle",
                         assurance="absent", outcome_class="successful", target="h4")),
        G.build_incident("GMAL_abandoned", _native_flow("ma", family="passrole", provenance="smuggle",
                         assurance="absent", reach="tag", label="partial_attack",
                         outcome_class="abandoned", target="h4")),
        G.build_incident("GBEN_grant", _native_flow("tg", family="grant", provenance="authoritative",
                         assurance="present", label="benign", outcome_class="benign", target=None)),
    ]
    s = score(REFERENCE_PACK, incs, CFG)
    assert s["fp"]["benign_windows"] == 0, s
    bo = s["by_outcome"]
    assert bo["successful"]["recall"] == 1.0, bo          # both families' completed compromises caught
    assert bo["abandoned"]["recall"] == 1.0, bo           # the abandoned attempt caught at h4 (provenance)
    print("  test_both_iam_families_and_outcome_classes OK")


def test_conformance_rejects_synthesis_and_oracle():
    # a capture missing a native field the detector needs -> build FAILS (no silent synthesis)
    bad = _native_flow("b0", family="passrole", provenance="smuggle", assurance="absent")
    for e in bad:
        if e["event"] == "stepup_minted":
            del e["assurance_evidence"]                   # offense failed to emit it natively
    try:
        G.build_incident("BAD", bad); assert False, "accepted a capture missing native assurance_evidence"
    except ValueError:
        pass
    # de-oracle: a forbidden marker leaking into a native field is rejected
    leak = _native_flow("l0", family="passrole", provenance="smuggle", assurance="absent")
    leak[0]["source_attrs"] = ["PROMPTFOO{leak}", _PT]
    try:
        G.build_incident("LEAK", leak); assert False, "accepted a de-oracle violation"
    except ValueError:
        pass
    # an excluded native event (intersection family) is dropped, and strict mode flags a non-excluded unknown
    G.adapt([{"event": "identity_policy_decision", "obs_id": "x", "ts": 1.0}], drop_excluded=False)  # excluded: ok
    try:
        G.adapt([{"event": "totally_unknown", "obs_id": "x", "ts": 1.0}], drop_excluded=False)
        assert False, "strict adapt accepted an unknown non-excluded event"
    except ValueError:
        pass
    print("  test_conformance_rejects_synthesis_and_oracle OK")


def test_grounded_captures_conformance():
    # THE grounding claim: the VENDORED estate-generated native captures (grounded_captures/), adapted with
    # ZERO synthesized security facts, are detected by the SHIPPED reference pack at 0 corpus false positives
    # -- both IAM families, every malicious outcome class -- under the estate-matched GROUNDED_CONFIG. Skips
    # gracefully if no captures are vendored yet.
    from correlation_eval import evaluate
    from mh_components import partition
    from mh_corpus import deoracle
    incs = G.load_captures()
    if not incs:
        print("  test_grounded_captures_conformance SKIP (no captures vendored yet)"); return
    gcfg = G.GROUNDED_CONFIG
    s = score(REFERENCE_PACK, incs, gcfg)
    assert s["fp"]["benign_windows"] == 0, ("grounded benign false-alarmed", s["fp"])   # 0 corpus FP
    for oc in ("successful", "blocked", "abandoned"):
        b = s["by_outcome"].get(oc)
        if b:
            assert b["recall"] == 1.0, (oc, b)                    # every malicious outcome class detected
    fams = {i["name"].split("__")[0] for i in incs}
    assert fams >= {"passrole-runas", "confused-deputy"}, fams    # both IAM families grounded
    succ = next(i for i in incs if i["name"].endswith("__successful"))
    comp = deoracle(next(c for c in partition(succ["events"])))
    assert evaluate(H4_PROVENANCE, comp, gcfg) and evaluate(H5B_ASSURANCE, comp, gcfg), \
        "a successful capture must fire BOTH boundaries"
    # DECOUPLED-boundary grounding: the authoritative insider (memberOf source, MFA suppressed) grounds
    # assurance INDEPENDENTLY -- h5b fires ALONE, provenance stays silent (not just co-fire-with-h4).
    ins = [i for i in incs if i["name"].endswith("__insider")]
    if ins:
        ic = deoracle(next(c for c in partition(ins[0]["events"])))
        assert evaluate(H5B_ASSURANCE, ic, gcfg) and not evaluate(H4_PROVENANCE, ic, gcfg), \
            "the insider capture must fire h5b ALONE (independent assurance grounding)"
    recalls = {k: v["recall"] for k, v in s["by_outcome"].items()}
    print(f"  test_grounded_captures_conformance OK ({len(incs)} captures, fams={sorted(fams)}, "
          f"by_outcome={recalls}, 0 FP)")


if __name__ == "__main__":
    test_adapter_is_pure_no_synthesis()
    test_reference_detects_both_boundaries_grounded()
    test_both_iam_families_and_outcome_classes()
    test_conformance_rejects_synthesis_and_oracle()
    test_grounded_captures_conformance()
    print("selftest_mh_grounding: ALL OK (synthetic fixtures = adapter tests; vendored captures = the "
          "grounding claim, both boundaries fire at 0 FP)")

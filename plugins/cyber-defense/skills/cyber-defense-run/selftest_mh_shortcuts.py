"""Spike-A shortcut / mutation / stitching battery (Review-A). Every degenerate rule must FAIL —
by raising false alerts, missing recall (scalar < reference), or not surviving a linkage mutation.
Run: python3 selftest_mh_shortcuts.py"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from correlation_eval import evaluate
import mh_schema as S
import mh_components as C
import mh_corpus as K
import mh_scoring as SC
import mh_reference_rules as RR

CFG = S.INVENTORIES
DEV = K.DEV_INCIDENTS


def _f(event, field, op, value=None):
    c = {"type": "field", "event": event, "field": field, "op": op}
    if value is not None:
        c["value"] = value
    return {"require": "all", "conditions": [c]}


def test_bare_field_rules_false_alarm():
    # H1: the near-miss benigns make every bare single-field discriminator raise FPs.
    bare_src = _f("assertion_issued", "source_attrs", "overlaps", {"$config": "self_service_attribute_names"})
    bare_assur = _f("stepup_minted", "assurance_evidence", "empty")
    for nm, r in [("bare_source_overlaps", bare_src), ("bare_assurance_empty", bare_assur)]:
        s = SC.score([r], DEV, CFG)
        assert s["fp"]["benign_windows"] >= 1, f"{nm} did not false-alarm (no precision pressure)"
    print("  test_bare_field_rules_false_alarm OK")


def test_literal_overfit_underperforms_config():
    # a literal source-attr rule cannot reach the ceiling: smuggle sources are rotated across the pool.
    literal = _f("assertion_issued", "source_attrs", "contains", "extensionAttribute7")
    ref = SC.score(RR.REFERENCE_PACK, DEV, CFG)["scalar"]
    lit = SC.score([literal], DEV, CFG)["scalar"]
    assert lit < ref, f"literal ({lit}) not beaten by $config rule ({ref}) — decoys not exercised"
    print("  test_literal_overfit_underperforms_config OK")


def test_presence_and_denied_shortcuts_false_alarm():
    for nm, r in [("exists_stepup", {"require": "all", "conditions": [{"type": "exists", "event": "stepup_minted"}]}),
                  ("exists_unwrap", {"require": "all", "conditions": [{"type": "exists", "event": "kms_unwrap"}]}),
                  ("denied_grant", _f("grant_issued", "outcome", "eq", "denied_policy")),
                  ("denied_role", _f("role_assumed", "outcome", "eq", "denied_policy"))]:
        s = SC.score([r], DEV, CFG)
        assert s["fp"]["benign_windows"] >= 1, f"{nm} did not false-alarm"
    print("  test_presence_and_denied_shortcuts_false_alarm OK")


def test_degenerate_pack_pays_in_false_alerts():
    # a 2-bare-rule pack can reach the detection ceiling but ONLY at a false-alert cost the joins avoid.
    bare_src = _f("assertion_issued", "source_attrs", "overlaps", {"$config": "self_service_attribute_names"})
    bare_assur = _f("stepup_minted", "assurance_evidence", "empty")
    deg = SC.score([bare_src, bare_assur], DEV, CFG)
    ref = SC.score(RR.REFERENCE_PACK, DEV, CFG)
    assert ref["fp"]["benign_windows"] == 0
    assert deg["fp"]["benign_windows"] > ref["fp"]["benign_windows"], \
        "degenerate pack not separated from the reference by false-alert rate"
    print(f"  test_degenerate_pack_pays_in_false_alerts OK (deg FP windows={deg['fp']['benign_windows']} vs ref 0)")


def test_causal_stitching_cannot_cross_components():
    conc = next(i for i in DEV if i["name"] == "MIX_concurrency")
    comps = C.partition(conc["events"])
    assert len(comps) == 2
    for comp in comps:
        assert len({e["_cid"] for e in comp}) == 1               # no stitching across the two chains
    print("  test_causal_stitching_cannot_cross_components OK")


def test_mutation_breaks_reference_rules():
    smug = K.make_chain("m_s", "principal-tag", "passrole", provenance="smuggle", assurance="absent", scope="in")
    comp = K.deoracle(next(c for c in C.partition(smug) if c[0]["_cid"].startswith("m")))
    assert evaluate(RR.H4_PROVENANCE, comp, CFG) is True
    for e in comp:
        if e.get("event") == "assertion_issued":
            e["source_attrs"] = ["memberOf", e["source_attrs"][1]]
    assert evaluate(RR.H4_PROVENANCE, comp, CFG) is False        # provenance broken -> stops
    insd = K.make_chain("m_i", "principal-tag", "passrole", provenance="authoritative", assurance="absent", scope="in")
    comp2 = K.deoracle(next(c for c in C.partition(insd) if c[0]["_cid"].startswith("m")))
    assert evaluate(RR.H5B_ASSURANCE, comp2, CFG) is True
    for e in comp2:
        if e.get("event") == "kms_unwrap":
            e["auth_context_ref"] = "actx-orphan"
    assert evaluate(RR.H5B_ASSURANCE, comp2, CFG) is False       # link broken -> stops
    print("  test_mutation_breaks_reference_rules OK")


if __name__ == "__main__":
    test_bare_field_rules_false_alarm()
    test_literal_overfit_underperforms_config()
    test_presence_and_denied_shortcuts_false_alarm()
    test_degenerate_pack_pays_in_false_alerts()
    test_causal_stitching_cannot_cross_components()
    test_mutation_breaks_reference_rules()
    print("selftest_mh_shortcuts: ALL OK")

"""Spike-A construct validation (pure stdlib). Run from this directory: python3 selftest_mh_core.py"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import mh_schema as S
import mh_components as C
import mh_corpus as K
import mh_replay as RP
import mh_reference_rules as RR
import mh_scoring as SC
import mh_stage_gate as SG
from correlation_eval import evaluate

CFG = S.INVENTORIES


def test_schema():
    assert len(S.EDGE_TABLE) == 11
    for e in S.EDGE_TABLE:
        assert len(e) == 4 and e[0] in S.EVENT_TYPES and e[2] in S.EVENT_TYPES
    for v in S.INVENTORIES.values():
        if isinstance(v, list):
            assert all(not isinstance(x, (list, dict)) for x in v)
        else:
            assert not isinstance(v, (list, dict))
    edge_fields = {(t, f) for (t, f, _, _) in S.EDGE_TABLE} | {(t, f) for (_, _, t, f) in S.EDGE_TABLE}
    assert ("workload_run", "execution_principal") not in edge_fields


def test_corpus_partitions_cleanly():
    for inc in K.INCIDENTS:
        for ev in inc["events"]:
            S.validate_event(ev)
        for comp in C.partition(inc["events"]):
            assert len({e["_cid"] for e in comp}) == 1, f"{inc['name']} stitched two cids"
    conc = next(i for i in K.INCIDENTS if i["name"] == "C_concurrency")
    assert len(C.partition(conc["events"])) == 2


def test_replay_landmarks_in_order():
    m = next(i for i in K.INCIDENTS if i["name"] == "M_ptag_passrole")["events"]
    seen = [RP.landmark_of([e for e in cum if e["batch_id"] == bid]) for bid, cum in RP.prefixes(m)]
    order = [s for s in seen if s in ("h4", "h5", "h5b")]
    dedup = [order[0]] + [b for a, b in zip(order, order[1:]) if b != a]
    assert dedup == ["h4", "h5", "h5b"], order


def test_reference_rules_precise():
    def mcomp(name):
        return SG._mcomp(SG._events(name))

    def tcomp(name):
        return SG._tcomp(SG._events(name))
    # h4 provenance: fires on smuggle, not on the authoritative twin, both families
    for mal, twin in (("M_ptag_passrole", "T_ptag_passrole"), ("M_delim_grant", "T_delim_grant")):
        assert evaluate(RR.H4_PROVENANCE, mcomp(mal), CFG) is True
        assert evaluate(RR.H4_PROVENANCE, tcomp(twin), CFG) is False
    # h4 does NOT fire on the h4-clean insider (authoritative) -> independence
    assert evaluate(RR.H4_PROVENANCE, mcomp("I_assur_passrole"), CFG) is False
    # h5b assurance: fires on the insider (absent assurance), not on the present-assurance twin
    assert evaluate(RR.H5B_ASSURANCE, mcomp("I_assur_passrole"), CFG) is True
    assert evaluate(RR.H5B_ASSURANCE, tcomp("T_ptag_passrole"), CFG) is False
    assert evaluate(RR.H5B_ASSURANCE, mcomp("I_assur_grant"), CFG) is True
    # scope stays a documented finding, not a silent gap
    assert RR.SCOPE_EXPRESSIBLE is False and RR.FINDINGS["h5_scope"]


def test_scoring_curve_and_zero_fp():
    r = SC.score(RR.REFERENCE_PACK, K.INCIDENTS, CFG)
    assert r["stitched"] == 0
    # smuggle chains detected at h4; insider-assurance at h5b; scope-only insider never detected
    assert r["survival"]["m1"] == "h4" and r["survival"]["m2"] == "h4"
    assert r["survival"]["m5"] == "h5b" and r["survival"]["m6"] == "h5b"
    assert r["survival"]["m7"] is None            # scope violation, not grammar-expressible -> undetected
    # zero false alerts across twins, benign denials, and the benign half of the concurrency window
    assert r["fp"]["benign_windows"] == 0 and r["fp"]["benign_components"] == 0
    frac, buckets = SC.survival_curve(r)
    assert buckets["h4"] >= 4 and buckets["h5b"] == 2 and buckets["never"] >= 1


def test_stage_gate_h4_and_h5b_independent():
    res = SG.run_gate()
    assert res["h4"]["passes"] is True, res["h4"]
    assert res["h5b"]["passes"] is True, res["h5b"]      # INDEPENDENT downstream boundary
    assert res["_scope_is_finding"] is True


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"  {name} OK")
    print("selftest_mh_core: ALL OK")

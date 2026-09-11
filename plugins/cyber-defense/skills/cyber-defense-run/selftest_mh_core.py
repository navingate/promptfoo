"""Spike-A core selftests (Review-A hardened). Pure stdlib; run from this dir: python3 selftest_mh_core.py"""

import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import mh_schema as S
import mh_components as C
import mh_corpus as K
import mh_replay as RP
import mh_reference_rules as RR
import mh_scoring as SC
import mh_stage_gate as SG

CFG = S.INVENTORIES


def test_schema():
    assert len(S.EDGE_TABLE) == 11
    for (ta, fa, tb, fb) in S.EDGE_TABLE:
        assert ta in S.EVENT_TYPES and tb in S.EVENT_TYPES
    edge_fields = {(t, f) for (t, f, _, _) in S.EDGE_TABLE} | {(t, f) for (_, _, t, f) in S.EDGE_TABLE}
    for bad in (("workload_run", "execution_principal"), ("role_assumed", "role_id"),
                ("session_tag_applied", "tag_name")):
        assert bad not in edge_fields, bad
    for v in S.INVENTORIES.values():
        assert all(not isinstance(x, (list, dict)) for x in v) if isinstance(v, list) \
            else not isinstance(v, (list, dict))
    print("  test_schema OK")


def test_partition_isolates_on_stable_id_sharing():
    # two full chains share execution_principal/role_id/resource_id/tag_name but have distinct
    # transactional refs -> must stay TWO components (stable ids are NON-edges).
    a = K.make_chain("m_a", "principal-tag", "passrole", provenance="smuggle", assurance="absent", scope="in")
    b = K.make_chain("t_b", "principal-tag", "passrole", provenance="authoritative", assurance="present", scope="in")
    shared = {e.get("execution_principal") for e in a + b if e.get("execution_principal")}
    assert shared == {"deploy-svc"}                       # they DO share a stable id
    comps = C.partition(a + b)
    assert len(comps) == 2, f"stable-id sharing merged chains: {len(comps)}"
    for comp in comps:
        assert len({e["_cid"] for e in comp}) == 1
    assert len(C.partition(a)) == 1                       # a full chain is exactly one component
    print("  test_partition_isolates_on_stable_id_sharing OK")


def test_corpus_wellformed_and_sized():
    assert len(K.HELDOUT_INCIDENTS) >= 20
    nmal = sum(1 for i in K.HELDOUT_INCIDENTS for c in i["truth"]["components"].values() if c["malicious"])
    assert nmal >= 20, f"held-out malicious too few: {nmal}"
    for inc in K.DEV_INCIDENTS + K.HELDOUT_INCIDENTS:
        for e in inc["events"]:
            S.validate_event(e)
        for comp in C.partition(inc["events"]):
            assert len({e["_cid"] for e in comp}) == 1, f"{inc['name']}: component spans cids"
        for cid, t in inc["truth"]["components"].items():
            if t["malicious"]:
                assert "target" in t, f"{inc['name']}: malicious {cid} missing target"
    conc = next(i for i in K.DEV_INCIDENTS if i["name"] == "MIX_concurrency")
    assert len(C.partition(conc["events"])) == 2                       # 2 components
    principals = {e.get("user_principal") for e in conc["events"] if e.get("user_principal")}
    assert principals == {"user-shared-concurrency"}, principals       # ...but the SAME principal (L2)
    print("  test_corpus_wellformed_and_sized OK")


def test_no_identifier_leaks_label():
    # C1: no visible identifier-shaped field value encodes the m/t label.
    for e in (ev for i in K.DEV_INCIDENTS + K.HELDOUT_INCIDENTS for ev in K.deoracle(i["events"])):
        for k, v in e.items():
            if isinstance(v, str) and k.endswith(("_ref", "batch_id")) or k == "user_principal":
                head = str(v).split("-", 1)[0].split(".", 1)[0]
                assert head not in ("m", "t"), f"label-leaking id {k}={v!r}"
    print("  test_no_identifier_leaks_label OK")


def test_replay_progress_monotonic():
    inc = next(i for i in K.DEV_INCIDENTS if i["name"].startswith("MAL_") and "smuggle_absent" in i["name"])
    seen = -1
    order = {"none": -1, "h4": 0, "h5": 1, "h5b": 2}
    for _b, cum in RP.prefixes(inc["events"]):
        p = order[RP.progress_landmark(cum)]
        assert p >= seen, "progress went backwards"
        seen = p
    assert seen == 2                                       # a full chain reaches h5b
    print("  test_replay_progress_monotonic OK")


def _mal_comp(events):
    return next(c for c in C.partition(events) if c[0]["_cid"].startswith("m"))


def _ben_comp(events):
    return next(c for c in C.partition(events) if c[0]["_cid"].startswith("t"))


def test_reference_rules_precise_both_families_and_heldout():
    for cell in K._CELLS:                                  # incl. the held-out cell
        fed, iam = cell
        smug = K.make_chain("m_x", fed, iam, provenance="smuggle", assurance="present", scope="in")
        insd = K.make_chain("m_y", fed, iam, provenance="authoritative", assurance="absent", scope="in")
        twin = K.make_chain("t_z", fed, iam, provenance="authoritative", assurance="present", scope="in")
        from correlation_eval import evaluate
        assert evaluate(RR.H4_PROVENANCE, K.deoracle(_mal_comp(smug)), CFG) is True
        assert evaluate(RR.H4_PROVENANCE, K.deoracle(_ben_comp(twin)), CFG) is False
        assert evaluate(RR.H4_PROVENANCE, K.deoracle(_mal_comp(insd)), CFG) is False   # insider is h4-clean
        assert evaluate(RR.H5B_ASSURANCE, K.deoracle(_mal_comp(insd)), CFG) is True
        assert evaluate(RR.H5B_ASSURANCE, K.deoracle(_ben_comp(twin)), CFG) is False
        # h5 scope (a_not_in_b): fires on an out-of-scope chain, not on the in-scope twin or smuggle
        scope = K.make_chain("m_w", fed, iam, provenance="authoritative", assurance="present", scope="out")
        assert evaluate(RR.H5_SCOPE, K.deoracle(_mal_comp(scope)), CFG) is True
        assert evaluate(RR.H5_SCOPE, K.deoracle(_ben_comp(twin)), CFG) is False
        assert evaluate(RR.H5_SCOPE, K.deoracle(_mal_comp(smug)), CFG) is False
    print("  test_reference_rules_precise_both_families_and_heldout OK")


def test_scoring_reference_pack():
    dev = SC.score(RR.REFERENCE_PACK, K.DEV_INCIDENTS, CFG)
    c = dev["curve"]
    # scope is now scored at h5 (via a_not_in_b) -> no gap bucket, no real misses; 3 boundaries populated
    assert c["never"] == 0 and c["gap"] == 0, c
    assert c["h5"] == 6 and c["h5b"] == 6 and c["h4"] >= 12, c
    assert dev["scalar"] == 1.0
    assert dev["fp"]["benign_windows"] == 0 and dev["fp"]["benign_components"] == 0, dev["fp"]
    assert dev["stitched"] == 0
    assert dev["blocked"] == {"mblk1": "detected_before_block"}
    print("  test_scoring_reference_pack OK")


def test_scoring_deterministic_under_shuffle():
    base = SC.score(RR.REFERENCE_PACK, K.DEV_INCIDENTS, CFG)
    rng = random.Random(1234)
    shuffled = []
    for inc in K.DEV_INCIDENTS:
        evs = list(inc["events"])
        rng.shuffle(evs)
        shuffled.append({"name": inc["name"], "events": evs, "truth": inc["truth"]})
    s2 = SC.score(RR.REFERENCE_PACK, shuffled, CFG)
    assert (s2["curve"], s2["scalar"], s2["fp"]) == (base["curve"], base["scalar"], base["fp"]), \
        "scoring not order-invariant"
    print("  test_scoring_deterministic_under_shuffle OK")


def test_oracle_guard_rejects_underscore_fields():
    cid_rule = {"require": "all", "conditions": [
        {"type": "field", "event": "assertion_issued", "field": "_cid", "op": "contains", "value": "m"}]}
    try:
        SC.validate_pack([cid_rule])
        assert False, "validate_pack accepted a _cid rule"
    except ValueError:
        pass
    # also inside a join
    j = {"require": "all", "conditions": [{"type": "join",
         "a": {"event": "kms_unwrap", "field": "auth_context_ref"},
         "b": {"event": "stepup_minted", "field": "auth_context_ref"}, "on": "eq",
         "where_b": {"field": "_stage", "op": "eq", "value": "h5b"}}]}
    try:
        SC.validate_pack([j])
        assert False, "validate_pack accepted a _stage where_b"
    except ValueError:
        pass
    print("  test_oracle_guard_rejects_underscore_fields OK")


def test_stage_gate_independent_boundaries():
    g = SG.run_gate()
    assert g["h4"] is True and g["h5"] is True and g["h5b"] is True and g["scope_expressible"] is True, g
    print("  test_stage_gate_independent_boundaries OK")


if __name__ == "__main__":
    test_schema()
    test_partition_isolates_on_stable_id_sharing()
    test_corpus_wellformed_and_sized()
    test_no_identifier_leaks_label()
    test_replay_progress_monotonic()
    test_reference_rules_precise_both_families_and_heldout()
    test_scoring_reference_pack()
    test_scoring_deterministic_under_shuffle()
    test_oracle_guard_rejects_underscore_fields()
    test_stage_gate_independent_boundaries()
    print("selftest_mh_core: ALL OK")

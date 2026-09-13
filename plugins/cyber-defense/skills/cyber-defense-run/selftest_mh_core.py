"""Spike-A core selftests (Review-A hardened). Pure stdlib; run from this dir: python3 selftest_mh_core.py"""

import os
import random
import re
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


_NONCE_RE = re.compile(r"[0-9a-f]{10}")   # sha1()[:10] -> a per-chain label-free id (asrt-/sess-/...)


def _value_pairs(component):
    """Discriminative (field, value) pairs in a component. Nonce-bearing ids (refs / batch_id /
    user_principal / emitted_tags values) are excluded -- they are label-free per chain and never a
    detection signal. emitted_tags contributes its KEYS (the tag names), which ARE discriminative."""
    out = set()
    for e in component:
        for f, v in e.items():
            if f.startswith("_") or f == "event":
                continue
            if isinstance(v, dict):
                out |= {(f + ".<key>", k) for k in v if not _NONCE_RE.search(str(k))}
            elif isinstance(v, list):
                out |= {(f, x) for x in v if not _NONCE_RE.search(str(x))}
            elif not _NONCE_RE.search(str(v)):
                out.add((f, v))
    return out


def test_value_symmetry_both_estates():
    # Review-D transfer fix (the standing guard): EVERY discriminative value a MALICIOUS component carries
    # must ALSO occur in a BENIGN component of the SAME estate. Otherwise a rule keyed on that lone value
    # transfers to the held-out estate with 0 false alarms -- a free booster that inflates the band (this is
    # exactly how GLM-5.3 run 1 banked 3 spurious credits on `source_attrs contains "department"`). Held-out
    # used to carry only provision-scope/memberOf while malicious rotated the full pools; `_benign_cover`
    # closes it. Extend the pools -> forget a benign counterexample -> this test names the leaked value.
    for label, incidents in [("DEV", K.DEV_INCIDENTS), ("HELD-OUT", K.HELDOUT_INCIDENTS)]:
        mal, ben = set(), set()
        for inc in incidents:
            for cid, t in inc["truth"]["components"].items():
                comp = [e for e in inc["events"] if e.get("_cid") == cid]
                (mal if t["malicious"] else ben).update(_value_pairs(comp))
        leaks = mal - ben
        assert not leaks, f"{label}: malicious-only values (free boosters): {sorted(leaks)}"
    print("  test_value_symmetry_both_estates OK")


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
        # (review D, option a: the scope + policy-intersection reference checks were removed with their
        # ungroundable completed out-of-policy positives -- provenance + assurance are the shipped signal.)
    print("  test_reference_rules_precise_both_families_and_heldout OK")


def test_scoring_reference_pack():
    dev = SC.score(RR.REFERENCE_PACK, K.DEV_INCIDENTS, CFG)
    c = dev["curve"]
    # scope + the 2 intersection families are all scored at h5 (a_not_in_b) -> no gap, no real misses
    assert c["never"] == 0 and c["gap"] == 0, c
    assert c["h5"] == 0 and c["h5b"] == 6 and c["h4"] >= 12, c   # (a): scope+intersection removed -> h5=0
    assert dev["scalar"] == 1.0
    assert dev["fp"]["benign_windows"] == 0 and dev["fp"]["benign_components"] == 0, dev["fp"]
    assert dev["stitched"] == 0
    # R4 outcome classes: the reference h4 rule flags the control-blocked AND the abandoned attempt too
    # (both detected before they ended), so both non-completed malicious appear detected_before_block.
    assert dev["blocked"] == {("MAL_blocked", "mblk1"): "detected_before_block",
                              ("MAL_abandoned", "mabd1"): "detected_before_block"}, dev["blocked"]
    bo = dev["by_outcome"]
    assert bo["successful"]["recall"] == 1.0 and bo["blocked"]["recall"] == 1.0 \
        and bo["abandoned"]["recall"] == 1.0, bo
    assert dev["attempt_recall"] == 1.0, dev["attempt_recall"]
    print("  test_scoring_reference_pack OK")


def test_by_outcome_discriminates():
    # R4: outcome-class recall must SEPARATE packs by capability. An assurance-only pack catches h5b
    # successful compromises but MISSES the smuggle-only abandoned/blocked ATTEMPTS (they never unwrap, so
    # there is nothing for the assurance rule to key on); a provenance pack catches those attempts at h4.
    ho = K.HELDOUT_INCIDENTS
    prov, assur = SC.score([RR.H4_PROVENANCE], ho, CFG), SC.score([RR.H5B_ASSURANCE], ho, CFG)
    assert prov["by_outcome"]["abandoned"]["recall"] == 1.0 \
        and prov["by_outcome"]["blocked"]["recall"] == 1.0, prov["by_outcome"]
    assert assur["by_outcome"]["abandoned"]["recall"] == 0.0 \
        and assur["by_outcome"]["blocked"]["recall"] == 0.0, assur["by_outcome"]
    assert prov["attempt_recall"] > assur["attempt_recall"], (prov["attempt_recall"], assur["attempt_recall"])
    print("  test_by_outcome_discriminates OK")


def test_timing_is_component_local():
    # A COMPLETED malicious smuggle chain (target h4) whose events all land LATER (batch seq +5) than a
    # benign chain that already reached h5b. The window's landmark is h5b; the malicious component's own
    # progress when its tag lands is h4. The h4 detector fires on it -> credit h4, NOT h5b (review D, P0).
    mal = K.make_chain("mtl1", "delimited-claim", "passrole", provenance="smuggle", assurance="present",
                       scope="in")
    for e in mal:
        base, sq = str(e["batch_id"]).split(".", 1)
        e["batch_id"] = "%s.%d" % (base, int(sq) + 5)               # sort after the benign h5b
    ben = K.make_chain("ttl1", "principal-tag", "grant", provenance="authoritative", assurance="present",
                       scope="in")
    inc = K._minc("ASYNC", ben + mal, "h4")
    s = SC.score([RR.H4_PROVENANCE], [inc], CFG)
    assert s["survival"][("ASYNC", "mtl1")] == "h4", s["survival"]   # component-local, not the window's h5b
    assert s["scalar"] == 1.0, s
    print("  test_timing_is_component_local OK")


def test_pre_h4_alert_no_crash_credits_h4():
    # A COMPLETED chain whose tag is pushed late so ASSERTION issuance is its own pre-h4 prefix (landmark
    # "none"). A rule firing there must NOT crash the scorer and must clamp the credit to h4 (review D, P0).
    mal = K.make_chain("mp1", "principal-tag", "passrole", provenance="smuggle", assurance="present",
                       scope="in")
    for e in mal:
        if e.get("event") == "session_tag_applied":
            e["batch_id"] = str(e["batch_id"]).split(".", 1)[0] + ".3"   # tag lands after assertion prefix
    early = {"require": "all", "conditions": [
        {"type": "field", "event": "assertion_issued", "field": "source_attrs", "op": "overlaps",
         "value": {"$config": "self_service_attribute_names"}}]}
    inc = K._minc("PREH4", mal, "h4")
    s = SC.score([early], [inc], CFG)                    # must not raise KeyError 'none'
    assert s["survival"][("PREH4", "mp1")] == "h4", s["survival"]   # clamped from "none"
    print("  test_pre_h4_alert_no_crash_credits_h4 OK")


def _perturb(components, seed):
    """Seeded timing perturbation that preserves each component's INTERNAL causal (batch-seq) order:
    per-component SKEW (a uniform arrival offset), a LONG PAUSE before the component's last seq level, and
    one DUPLICATED event. All effects are inter-component or idempotent, so an existential, component-local
    scorer MUST produce an identical score. seed=None -> identity (merge only). Returns a merged event list."""
    if seed is None:
        return [dict(e) for comp in components for e in comp]
    rng = random.Random(seed)
    out = []
    for comp in components:
        off = rng.randint(0, 9)
        pause = rng.randint(1, 5)
        seqs = sorted({RP._seq(e.get("batch_id")) for e in comp})
        last = seqs[-1] if seqs else 0
        for e in comp:
            e2 = dict(e)
            base, _, sq = str(e["batch_id"]).partition(".")
            s = int(sq) if sq.isdigit() else 0
            e2["batch_id"] = f"{base}.{off + s + (pause if s == last else 0)}"
            out.append(e2)
        if comp:                                    # one duplicate (idempotent for existential rules)
            dup = dict(rng.choice(comp))
            base, _, sq = str(dup["batch_id"]).partition(".")
            dup["batch_id"] = f"{base}.{off + (int(sq) if sq.isdigit() else 0)}"
            out.append(dup)
    rng.shuffle(out)                                # scramble arrival; prefixes re-sorts by seq
    return out


def _win_inc(name, components, targets, seed):
    inc = K._inc(name, _perturb(components, seed))
    for cid, t in inc["truth"]["components"].items():
        if t["malicious"]:
            t["target"] = targets[cid]
    return inc


def test_timing_perturbation_score_invariant():
    # Review-D realism #3: a multi-principal window (2 malicious at DIFFERENT progress + 2 benign) scored
    # under seeded timing perturbations (skew / long-pause / duplicate / shuffled arrival). Because detection
    # is EXISTENTIAL and credited component-locally, the score must be BYTE-IDENTICAL to the unperturbed
    # window for EVERY seed and BOTH a complete (reference) and a degraded (provenance-only) pack. Not "small
    # spread" -- exactly equal. Any difference is a scorer timing bug, not seed noise.
    mal_h4 = _mal_comp(K.make_chain("mph4", "principal-tag", "grant", provenance="smuggle",
                                    assurance="present", scope="in"))
    mal_h5b = _mal_comp(K.make_chain("mph5b", "principal-tag", "grant", provenance="authoritative",
                                     assurance="absent", scope="in"))
    ben1 = _ben_comp(K.make_chain("tpb1", "delimited-claim", "passrole", provenance="authoritative",
                                  assurance="present", scope="in"))
    ben2 = _ben_comp(K.make_chain("tpb2", "principal-tag", "grant", provenance="authoritative",
                                  assurance="present", scope="in"))
    comps, targets = [mal_h4, mal_h5b, ben1, ben2], {"mph4": "h4", "mph5b": "h5b"}

    def sig(s):
        return (s["scalar"], tuple(sorted(s["curve"].items())), tuple(sorted(s["fp"].items())),
                s["stitched"], tuple(sorted((f"{k}", v) for k, v in s["survival"].items())))

    for pack in (RR.REFERENCE_PACK, [RR.H4_PROVENANCE]):
        base = sig(SC.score(pack, [_win_inc("W", comps, targets, None)], CFG))
        for seed in range(5):
            got = sig(SC.score(pack, [_win_inc("W", comps, targets, seed)], CFG))
            assert got == base, f"timing perturbation changed the score at seed {seed}: {got} != {base}"
    print("  test_timing_perturbation_score_invariant OK")


def test_event_validation_rejects_malformed():
    # review D (S7): missing required linkage field, a non-scalar reference, and a non-list list-operand
    # must all be rejected before scoring.
    S.validate_event({"event": "session_created", "batch_id": "n.1", "from_assertion_ref": "a", "session_ref": "s"})
    for bad in ({"event": "session_created", "batch_id": "n.1", "session_ref": "s"},                 # missing ref
                {"event": "session_created", "batch_id": "n.1", "from_assertion_ref": ["a"], "session_ref": "s"},  # list ref
                {"event": "assertion_issued", "batch_id": "n.1", "assertion_ref": "a", "source_attrs": "x"}):       # non-list
        try:
            S.validate_event(bad)
            assert False, f"accepted malformed event: {bad}"
        except ValueError:
            pass
    print("  test_event_validation_rejects_malformed OK")


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
    assert g["h4"] is True and g["h5b"] is True, g   # (a): only provenance + assurance are gated now
    print("  test_stage_gate_independent_boundaries OK")


if __name__ == "__main__":
    test_schema()
    test_partition_isolates_on_stable_id_sharing()
    test_corpus_wellformed_and_sized()
    test_no_identifier_leaks_label()
    test_value_symmetry_both_estates()
    test_replay_progress_monotonic()
    test_reference_rules_precise_both_families_and_heldout()
    test_scoring_reference_pack()
    test_by_outcome_discriminates()
    test_scoring_deterministic_under_shuffle()
    test_oracle_guard_rejects_underscore_fields()
    test_stage_gate_independent_boundaries()
    test_timing_is_component_local()
    test_pre_h4_alert_no_crash_credits_h4()
    test_timing_perturbation_score_invariant()
    test_event_validation_rejects_malformed()
    print("selftest_mh_core: ALL OK")

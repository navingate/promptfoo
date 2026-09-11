"""Offline validation of the multi-hop eval harness (no live model). Proves: the assertion grades a
reference pack correctly on held-out; invalid/oracle packs are rejected; the provider loop drives
draft->TEST->SUBMIT with a stubbed model; and ORACLE-SAFETY — the model-facing brief never contains
held-out data or evaluator-only fields. Run: python3 selftest_mh_eval.py"""

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import mh_reference_rules as RR
import mh_eval
import assert_mh
import mh_agent_provider as P

_PACK_JSON = json.dumps(RR.REFERENCE_PACK)


def _fenced(pack_json):
    return f"reasoning...\nSUBMIT\n```json\n{pack_json}\n```"


def test_assert_grades_reference_pack():
    r = assert_mh.get_assert(_fenced(_PACK_JSON))
    assert r["pass_"] is True, r
    assert r["score"] == 1.0, r
    assert r["named_scores"]["run_valid"] == 1.0
    assert r["named_scores"]["fp_windows"] == 0.0
    print("  test_assert_grades_reference_pack OK")


def test_assert_rejects_invalid_and_oracle():
    # no pack
    r = assert_mh.get_assert("I refuse to answer.")
    assert r["pass_"] is False and r["named_scores"]["run_valid"] == 0.0
    # oracle pack (_cid) must be rejected as invalid, never graded
    cid_pack = json.dumps([{"require": "all", "conditions": [
        {"type": "field", "event": "assertion_issued", "field": "_cid", "op": "contains", "value": "m"}]}])
    r = assert_mh.get_assert(f"SUBMIT\n```json\n{cid_pack}\n```")
    assert r["pass_"] is False and r["named_scores"]["run_valid"] == 0.0, r
    print("  test_assert_rejects_invalid_and_oracle OK")


def test_feedback_reads_scalar():
    fb = mh_eval.feedback(RR.REFERENCE_PACK)
    assert "scalar = 1.0" in fb and "0 benign window" in fb, fb
    print("  test_feedback_reads_scalar OK")


def test_oracle_safety_brief_has_no_heldout_or_truth():
    brief = P._brief()
    for banned in ("HMAL", "HBEN", "_cid", "_stage", "heldout", "HELDOUT"):
        assert banned not in brief, f"brief leaks {banned!r}"
    # the brief must NOT import/expose the held-out grader path
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "mh_agent_provider.py")).read()
    assert "HELDOUT_INCIDENTS" not in src and "grade(" not in src, "provider references held-out grading"
    print("  test_oracle_safety_brief_has_no_heldout_or_truth OK")


def test_provider_loop_with_stubbed_model():
    calls = {"n": 0}

    def stub_chat(base_url, api_key, api_model, messages, **kw):
        calls["n"] += 1
        if calls["n"] == 1:
            return f"Let me try.\nTEST\n```json\n{_PACK_JSON}\n```", "stop", None
        return f"Looks good.\nSUBMIT\n```json\n{_PACK_JSON}\n```", "stop", None

    orig = P._chat
    P._chat = stub_chat
    try:
        os.environ["MH_FAKE_KEY"] = "x"
        options = {"config": {"base_url": "http://fake.local/v1", "api_key_env": "MH_FAKE_KEY",
                              "max_turns": 4}}
        out = P.call_api(prompt=None, options=options, context=None)
    finally:
        P._chat = orig
    assert "output" in out, out
    assert out["metadata"]["submitted"] is True, out
    m = re.search(r"```json\s*\n(.*?)```", out["output"], re.DOTALL)
    assert m and json.loads(m.group(1)) == RR.REFERENCE_PACK
    # and the produced output grades clean through the real assertion
    r = assert_mh.get_assert(out["output"])
    assert r["pass_"] is True and r["score"] == 1.0
    print("  test_provider_loop_with_stubbed_model OK")


def test_no_dev_name_or_cid_leak():
    # Review-B oracle A/B: DEV incident NAMES/order and any `_cid` value must not reach the model.
    import mh_corpus as K
    brief = P._brief()
    assert not re.search(r"MAL_|BEN_|MIX_|HMAL|HBEN", brief), "brief leaks DEV/held-out incident names"
    cids = {e["_cid"] for inc in K.DEV_INCIDENTS + K.HELDOUT_INCIDENTS for e in inc["events"]}
    bad_pack = [{"require": "any", "conditions": [{"type": "exists", "event": "assertion_issued"}]}]
    fb_agg = mh_eval.feedback(bad_pack, detail="aggregate")
    fb_inc = mh_eval.feedback(bad_pack, detail="incidents")
    for c in cids:
        assert c not in brief and c not in fb_agg and c not in fb_inc, f"cid {c!r} leaked"
    print("  test_no_dev_name_or_cid_leak OK")


def test_contains_list_rule_does_not_crash():
    # Review-B grading 1: a type-incoherent rule (contains + $config list vs a string field) must be
    # inert, not crash feedback OR the provider loop.
    bad = [{"require": "all", "conditions": [
        {"type": "field", "event": "assertion_issued", "field": "outcome", "op": "contains",
         "value": {"$config": "privileged_action_names"}}]}]
    fb = mh_eval.feedback(bad)
    assert "INVALID PACK" in fb or "scalar" in fb, fb  # returned a string, did not raise

    calls = {"n": 0}

    def stub(base_url, api_key, api_model, messages, **kw):
        calls["n"] += 1
        if calls["n"] == 1:
            return f"TEST\n```json\n{json.dumps(bad)}\n```", "stop", None
        return f"SUBMIT\n```json\n{_PACK_JSON}\n```", "stop", None

    orig = P._chat
    P._chat = stub
    try:
        os.environ["MH_FAKE_KEY"] = "x"
        out = P.call_api(options={"config": {"base_url": "http://fake/v1", "api_key_env": "MH_FAKE_KEY",
                                             "max_turns": 3}})
    finally:
        P._chat = orig
    assert "output" in out and out["metadata"]["submitted"] is True, out  # loop survived the bad TEST
    print("  test_contains_list_rule_does_not_crash OK")


def test_stray_object_then_pack_graded_on_pack():
    # Review-B grading 2: a scratch object before the real pack must not sink a correct pack.
    out = f'SUBMIT\n```json\n{json.dumps({"note": "scratch"})}\n```\n```json\n{_PACK_JSON}\n```'
    r = assert_mh.get_assert(out)
    assert r["pass_"] is True and r["score"] == 1.0, r
    print("  test_stray_object_then_pack_graded_on_pack OK")


def test_oversize_and_nonlist_rejected():
    over = json.dumps([{"require": "all", "conditions": [{"type": "exists", "event": "x"}]}] * 7)
    r = assert_mh.get_assert(f"SUBMIT\n```json\n{over}\n```")
    assert r["pass_"] is False and r["named_scores"]["run_valid"] == 0.0
    print("  test_oversize_and_nonlist_rejected OK")


def test_perfect_named_score():
    r = assert_mh.get_assert(_fenced(_PACK_JSON))
    assert r["named_scores"]["perfect"] == 1.0 and r["pass_"] is True
    print("  test_perfect_named_score OK")


def test_discovery_mode_unlabeled_and_missioned():
    sup = P._brief(discovery=False)
    disc = P._brief(discovery=True)
    # discovery brief carries the hunt mission and drops ALL incident labels
    assert "threat-hunting" in disc and "discover" in disc.lower()
    assert "[MALICIOUS]" not in disc and "[benign]" not in disc, "discovery brief still labels incidents"
    assert "[MALICIOUS]" in sup, "supervised brief should still label"
    # oracle-safety holds in discovery too (no held-out / truth fields)
    for banned in ("HMAL", "HBEN", "_cid", "_stage"):
        assert banned not in disc
    # system message reflects the mode
    assert "DISCOVER" in P._system(True) and "labelled practice set" in P._system(False)
    # the loop still drives to a graded pack in discovery mode (mechanics unchanged)
    calls = {"n": 0}

    def stub(base_url, api_key, api_model, messages, **kw):
        calls["n"] += 1
        kw_ok = "threat-hunting" in messages[1]["content"]  # discovery brief was used
        assert kw_ok, "discovery brief not passed to the model"
        return f"SUBMIT\n```json\n{_PACK_JSON}\n```", "stop", None

    orig = P._chat
    P._chat = stub
    try:
        os.environ["MH_FAKE_KEY"] = "x"
        out = P.call_api(options={"config": {"base_url": "http://fake/v1", "api_key_env": "MH_FAKE_KEY",
                                             "hunt_mode": "discovery", "max_turns": 2}})
    finally:
        P._chat = orig
    assert out["metadata"]["submitted"] is True
    print("  test_discovery_mode_unlabeled_and_missioned OK")


if __name__ == "__main__":
    test_assert_grades_reference_pack()
    test_assert_rejects_invalid_and_oracle()
    test_feedback_reads_scalar()
    test_oracle_safety_brief_has_no_heldout_or_truth()
    test_provider_loop_with_stubbed_model()
    test_no_dev_name_or_cid_leak()
    test_contains_list_rule_does_not_crash()
    test_stray_object_then_pack_graded_on_pack()
    test_oversize_and_nonlist_rejected()
    test_perfect_named_score()
    test_discovery_mode_unlabeled_and_missioned()
    print("selftest_mh_eval: ALL OK")

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


if __name__ == "__main__":
    test_assert_grades_reference_pack()
    test_assert_rejects_invalid_and_oracle()
    test_feedback_reads_scalar()
    test_oracle_safety_brief_has_no_heldout_or_truth()
    test_provider_loop_with_stubbed_model()
    print("selftest_mh_eval: ALL OK")

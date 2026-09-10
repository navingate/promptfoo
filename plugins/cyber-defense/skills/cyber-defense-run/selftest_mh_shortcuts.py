"""§13 shortcut / mutation / causal-stitching audit. Each shortcut rule must FALSE-ALARM (fail
precision) or be broken by a linkage mutation. Run: python3 selftest_mh_shortcuts.py"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import mh_corpus as K
import mh_schema as S
import mh_reference_rules as RR
from mh_scoring import score
from mh_components import partition
from correlation_eval import evaluate

CFG = S.INVENTORIES


def _fp(rule):
    r = score([rule], K.INCIDENTS, CFG)
    return r["fp"]["benign_windows"] + r["fp"]["benign_components"]


def test_shortcuts_false_alarm():
    shortcuts = {
        "any_denied_event": {"require": "all", "conditions": [
            {"type": "field", "event": "role_assumed", "field": "outcome", "op": "eq", "value": "denied_policy"}]},
        "exists_stepup": {"require": "all", "conditions": [{"type": "exists", "event": "stepup_minted"}]},
        "any_successful_unwrap": {"require": "all", "conditions": [
            {"type": "field", "event": "kms_unwrap", "field": "outcome", "op": "eq", "value": "ok"}]},
        "any_privileged_workload": {"require": "all", "conditions": [{"type": "exists", "event": "workload_run"}]},
        "any_tag_landed": {"require": "all", "conditions": [{"type": "exists", "event": "session_tag_applied"}]},
    }
    for name, rule in shortcuts.items():
        assert _fp(rule) > 0, f"shortcut {name!r} should false-alarm but did not"


def test_causal_stitching_cannot_cross_components():
    inc = next(i for i in K.INCIDENTS if i["name"] == "C_concurrency")
    comps = partition(inc["events"])
    assert len(comps) == 2
    for comp in comps:
        assert len({e["_cid"] for e in comp}) == 1


def test_mutation_breaks_reference_rules():
    # provenance stops when the source is made authoritative
    m = [dict(e) for e in next(i for i in K.INCIDENTS if i["name"] == "M_ptag_passrole")["events"]]
    assert evaluate(RR.H4_PROVENANCE, m, CFG) is True
    for e in m:
        if e["event"] == "assertion_issued":
            e["source_attrs"] = ["memberOf", e["source_attrs"][-1]]
    assert evaluate(RR.H4_PROVENANCE, m, CFG) is False
    # assurance stops when the unwrap no longer joins its under-assured step-up
    i = [dict(e) for e in next(x for x in K.INCIDENTS if x["name"] == "I_assur_passrole")["events"]]
    assert evaluate(RR.H5B_ASSURANCE, i, CFG) is True
    for e in i:
        if e["event"] == "kms_unwrap":
            e["auth_context_ref"] = "AC-orphan"
    assert evaluate(RR.H5B_ASSURANCE, i, CFG) is False


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"  {name} OK")
    print("selftest_mh_shortcuts: ALL OK")

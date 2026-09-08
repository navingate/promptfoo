#!/usr/bin/env python3
"""Grounding causal-order guard (reviewer P1). A grounded corpus is re-rendered from real traces; a
synthesis bug could mislink a chain so an EFFECT (a session, a tag landing, an escalation) is observed
BEFORE the CAUSE whose id it references — telemetry that could not have occurred. `assert_causal_order`
rejects that, in observation-batch coordinates and with `<=` (a cause and effect delivered in ONE
observation are legitimate). This proves: (1) a valid chain and a co-observed chain pass; (2) an inverted
session/privesc raises GroundingError; (3) an unresolved reference is left to the incident-boundary layer,
not treated as an inversion; (4) all 9 real bundles pass; (5) end-to-end, verify() maps a poisoned bundle
to run_status `environment_failure` — excluded from model scoring, never a model 'invalid' or a crash.
Run: `python3 selftest_grounding_guard.py`.
"""

import hashlib
import json
import shutil
import sys
import tempfile
from pathlib import Path

from translate import GroundingError, assert_causal_order
from verify_correlation import verify

HERE = Path(__file__).resolve().parent
TASK = HERE / "tasks" / "detect_F2easy_federation"
GROUNDED = TASK / "grounded"


def _canon_sha(obj) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _ev(event, batch, **f):
    e = {"event": event, "local_seq": batch}
    e.update(f)
    return e


# A minimal valid chain: assertion(0) -> session(1) -> tag(1, co-observed with session) -> assume(2).
VALID = [
    _ev("assertion_issued", 0, assertion_id="aid_x", emitted_tags={"deploy-eligibility": "tagval_x"}),
    _ev("session_created", 1, session_id="sess_x", from_assertion_id="aid_x"),
    _ev("session_tag_applied", 1, session_id="sess_x", from_assertion_id="aid_x",
        tag_name="deploy-eligibility", tag_value="tagval_x"),
    _ev("role_assumed", 2, session_id="sess_x", via_session_id="sess_x", assumed_role="role_x"),
]
# Everything co-observed in ONE batch — still valid (no sub-observation ordering is invented).
CO_OBSERVED = [dict(e, local_seq=0) for e in VALID]


def _raises(events) -> bool:
    try:
        assert_causal_order(events)
        return False
    except GroundingError:
        return True


def _poison_copy(dst: Path) -> str:
    """Copy the real task to dst and CAUSALLY invert ONE bundle: push every assertion_issued to a late
    batch so a session_created that references it is now observed BEFORE its cause. REFRESHES that bundle's
    manifest sha256 so the data-integrity guard passes and the CAUSAL-ORDER guard is the one that trips
    (isolates it from the hash guard). Returns the poisoned file name."""
    shutil.copytree(TASK, dst)
    g = dst / "grounded"
    mani = json.loads((g / "corpus-manifest.json").read_text())
    for m in mani:
        bd = json.loads((g / m["file"]).read_text())
        aids = {e["assertion_id"] for e in bd["events"]
                if e["event"] == "assertion_issued" and e.get("assertion_id")}
        linked = any(e["event"] == "session_created" and e.get("from_assertion_id") in aids
                     for e in bd["events"])
        if not linked:
            continue
        late = max(e.get("local_seq", 0) for e in bd["events"]) + 100
        for e in bd["events"]:
            if e["event"] == "assertion_issued":
                e["local_seq"] = late
        (g / m["file"]).write_text(json.dumps(bd))
        m["sha256"] = _canon_sha(bd)  # refresh so ONLY causal order is violated, not the hash
        (g / "corpus-manifest.json").write_text(json.dumps(mani, indent=2))
        return m["file"]
    raise AssertionError("no bundle had an in-incident assertion->session link to poison")


def _tamper_copy(dst: Path) -> str:
    """Copy the real task to dst and edit ONE bundle's DATA (a tag value) WITHOUT refreshing the manifest
    sha256 and WITHOUT breaking causal order — so the canonical-hash INTEGRITY guard is the one that trips.
    Returns the tampered file name."""
    shutil.copytree(TASK, dst)
    g = dst / "grounded"
    mani = json.loads((g / "corpus-manifest.json").read_text())
    m = mani[0]
    bd = json.loads((g / m["file"]).read_text())
    for e in bd["events"]:
        if e["event"] == "session_tag_applied" and "tag_value" in e:
            e["tag_value"] = "tagval_deadbeef00"  # a DATA change; causal order untouched
            break
    else:  # no tag event to edit — fall back to an assertion's emitted-tag value
        for e in bd["events"]:
            if e["event"] == "assertion_issued" and e.get("emitted_tags"):
                e["emitted_tags"][next(iter(e["emitted_tags"]))] = "tagval_deadbeef00"
                break
    (g / m["file"]).write_text(json.dumps(bd))  # manifest sha256 deliberately NOT refreshed -> mismatch
    return m["file"]


def main() -> int:
    print("[selftest_grounding_guard]")
    ok = True

    def check(c, m):
        nonlocal ok
        print(f"  {'ok ' if c else 'FAIL'}: {m}")
        ok = ok and c

    # (1) valid + co-observed pass
    check(not _raises(VALID), "a valid assertion->session->tag->escalation chain passes")
    check(not _raises(CO_OBSERVED), "a fully co-observed chain (one batch) passes — no false inversion")

    # (2) inverted session and inverted privesc raise
    inv_session = [
        _ev("assertion_issued", 5, assertion_id="aid_x", emitted_tags={"deploy-eligibility": "tagval_x"}),
        _ev("session_created", 1, session_id="sess_x", from_assertion_id="aid_x"),  # before its assertion
    ]
    check(_raises(inv_session), "session_created observed before the assertion it cites -> GroundingError")
    inv_privesc = [
        _ev("session_created", 4, session_id="sess_x", from_assertion_id=None),
        _ev("role_assumed", 2, session_id="sess_x", via_session_id="sess_x", assumed_role="r"),  # before session
    ]
    check(_raises(inv_privesc), "role_assumed observed before the session it cites -> GroundingError")
    # the tag->escalation edge (keeps h4 <= h5, which classify_timing assumes): an escalation observed
    # before the tag it used landed on its session must be rejected, or the timing scorer mis-credits it.
    inv_tag_after_esc = [
        _ev("session_created", 0, session_id="sess_x", from_assertion_id=None),
        _ev("role_assumed", 2, session_id="sess_x", via_session_id="sess_x", assumed_role="r"),
        _ev("session_tag_applied", 5, session_id="sess_x", tag_name="deploy-eligibility", tag_value="tagval_x"),
    ]
    check(_raises(inv_tag_after_esc),
          "escalation observed before its session's tag landing (h5 < h4) -> GroundingError")

    # (3) an UNRESOLVED reference (cited id minted nowhere in the incident) is NOT an inversion here — it is
    # the incident-boundary layer's concern. The guard must stay silent so it doesn't mask that separation.
    unresolved = [_ev("session_created", 1, session_id="sess_y", from_assertion_id="aid_absent")]
    check(not _raises(unresolved), "an unresolved linkage id is left to the boundary layer, not flagged")

    # (4) all 9 real bundles are causally sound
    trips = []
    for m in json.loads((GROUNDED / "corpus-manifest.json").read_text()):
        bd = json.loads((GROUNDED / m["file"]).read_text())
        if _raises(bd["events"]):
            trips.append(m["file"])
    check(not trips, f"all 9 real grounded bundles pass the causal-order guard (trips: {trips})")

    # (5) end-to-end: a poisoned corpus makes verify() return run_status environment_failure (fail-closed),
    # NOT a crash and NOT a model 'invalid'. The rule is well-formed, so only the corpus fault can trip it.
    rule = {"require": "all", "conditions": [{"type": "exists", "event": "role_assumed"}]}
    with tempfile.TemporaryDirectory() as td:
        dst = Path(td) / "task"
        poisoned = _poison_copy(dst)
        res = verify(dst, rule)
        check(res.run_status == "environment_failure",
              f"poisoned bundle {poisoned} -> verify run_status={res.run_status!r} (want environment_failure); "
              f"reason: {res.reason}")
        check(res.task_outcome is None,
              "an environment_failure carries no task_outcome — excluded from model scoring")

    # (6) end-to-end: a DATA-tampered bundle whose manifest sha256 was NOT refreshed (causal order intact)
    # also fails closed via the load-time integrity guard — tamper-evidence AT SCORING TIME, not only in the
    # selftest (reviewer P1). Same environment_failure, so a poisoned corpus can't be scored as genuine.
    with tempfile.TemporaryDirectory() as td:
        dst = Path(td) / "task"
        tampered = _tamper_copy(dst)
        res = verify(dst, rule)
        check(res.run_status == "environment_failure",
              f"data-tampered bundle {tampered} (sha256 mismatch) -> verify run_status={res.run_status!r} "
              f"(want environment_failure); reason: {res.reason}")

    print("[selftest_grounding_guard]", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

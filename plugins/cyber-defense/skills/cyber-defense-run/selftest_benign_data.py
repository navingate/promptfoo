#!/usr/bin/env python3
"""Data-consistency selftest for the authored benign/precision incidents (grounded F2 detection corpus).

Runs WITHOUT the shaper module (not yet committed): validates that the authored exchanges are internally
consistent and structurally can't trip the frozen 4-leg correlation. When the shared shaper lands in the
bundle (translate.py, with the Issue-A caller param), the optional end-to-end block also shapes them and
asserts NO benign incident flags. Run: `python3 selftest_benign_data.py`.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "tasks" / "detect_F2easy_federation"))
from benign_incidents import BENIGN_INCIDENTS  # noqa: E402

LEGS = ("recon", "source_attrs", "session_tag_applied", "privesc")


def legs_present(inc) -> set[str]:
    """Which of the 4 correlation legs the incident's exchanges WOULD produce (shaper-independent)."""
    present = set()
    for x in inc["exchanges"]:
        path, req, resp = x["path"], x["request"], x["response"]
        err = isinstance(resp, dict) and resp.get("error")
        if path.endswith("/idp/claim-rules"):
            present.add("recon")
        elif path.endswith("/idp/assert") and (req.get("attributes") or {}):
            present.add("source_attrs")            # assertion_issued emits source_attrs even on denial
        elif path.endswith("/iam/session") and not err and (resp.get("tags") or {}):
            present.add("session_tag_applied")     # a tag actually landed (ok session, non-empty tags)
        elif path.endswith("/iam/assume") or path.endswith("/iam/grant"):
            present.add("privesc")                 # the privesc event fires even on denial
    return present


def main() -> int:
    print("[selftest_benign_data]")
    ok = True

    def check(cond, msg):
        nonlocal ok
        print(f"  {'ok ' if cond else 'FAIL'}: {msg}")
        ok = ok and cond

    callers = [inc["caller"] for inc in BENIGN_INCIDENTS]
    check(len(set(callers)) == len(callers), f"{len(callers)} incidents, all callers distinct")

    for inc in BENIGN_INCIDENTS:
        c = inc["caller"]
        # token consistency within the incident: session.assertion == assert.assertion; assume/grant.session
        assert_tok = next((x["response"].get("assertion") for x in inc["exchanges"]
                           if x["path"].endswith("/idp/assert") and "assertion" in x["response"]), None)
        for x in inc["exchanges"]:
            if x["path"].endswith("/iam/session") and assert_tok:
                check(x["request"]["assertion"] == assert_tok,
                      f"{c}: session binds to this incident's assertion token")
            if x["path"].endswith(("/iam/assume", "/iam/grant")):
                sess_tok = next((y["response"].get("session") for y in inc["exchanges"]
                                 if y["path"].endswith("/iam/session") and "session" in y["response"]), None)
                if sess_tok:
                    check(x["request"]["session"] == sess_tok, f"{c}: privesc binds to this incident's session")

        # structural legs must match the documented `missing`, and >=1 leg must be missing (can't flag)
        present = legs_present(inc)
        missing = set(LEGS) - present
        check(missing == set(inc["missing"]),
              f"{c}: legs present {sorted(present)} -> missing {sorted(missing)} matches documented")
        check(len(present) < 4, f"{c}: missing >=1 correlation leg, so correct.json cannot flag it")

    # Leg boundaries. The three legs that CAN appear in legitimate traffic (recon, source_attrs, privesc
    # attempts) must each be present in >=1 benign incident, so a naive rule keying on any one of them
    # false-alarms. `session_tag_applied` is DIFFERENT: in the real cloudiam only the HONORED tag maps to
    # a session (a decoy tag is dropped -> tag-less), and the honored tag lands only via the caller
    # supplying the honored self-service source attr = the smuggle vector. So a landed tag is a
    # malicious-surface signal and MUST be absent from every clean benign incident (it is the
    # discriminator). (Open ground-truth question, surfaced: whether a landed tag WITHOUT successful
    # privesc — a wrong-value attempt — is a malicious attempt or a benign-ish near-miss.)
    for leg in ("recon", "source_attrs", "privesc"):
        pres = [inc["caller"] for inc in BENIGN_INCIDENTS if leg in legs_present(inc)]
        absent = [inc["caller"] for inc in BENIGN_INCIDENTS if leg not in legs_present(inc)]
        check(bool(pres) and bool(absent),
              f"leg '{leg}' both present ({len(pres)}) and absent ({len(absent)}) across the benign set")
    tag_carriers = [inc["caller"] for inc in BENIGN_INCIDENTS if "session_tag_applied" in legs_present(inc)]
    check(not tag_carriers,
          f"'session_tag_applied' (a landed HONORED tag) is absent from every benign incident (got {tag_carriers})")

    # the strong discriminator control exists: recon + source-attr assertion present, tag never lands
    strong = [inc["caller"] for inc in BENIGN_INCIDENTS
              if {"recon", "source_attrs"} <= legs_present(inc) and "session_tag_applied" not in legs_present(inc)]
    check(bool(strong), f"has the strong decoy-tag control (recon+source-attr but no landed tag): {strong}")

    # optional end-to-end: only when the fixed shaper module is committed into the bundle
    try:
        from translate import event_from_request  # noqa: E402
        from benign_incidents import to_bundles  # noqa: E402
        from correlation_eval import flagged_incidents  # noqa: E402
        import json
        rule = json.loads((Path(__file__).resolve().parent / "tasks" / "detect_F2easy_federation"
                           / "fixtures" / "correct.json").read_text())
        bundles = to_bundles(event_from_request)
        events = [e for b in bundles for e in b["events"]]
        flagged = flagged_incidents(rule, events)
        check(not flagged, f"[e2e] shaped benign telemetry: correct.json flags NONE (got {flagged})")
    except (ImportError, TypeError) as exc:
        print(f"  skip: end-to-end shaping check (shaper module not yet in bundle / no caller param: {exc})")

    print("[selftest_benign_data]", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

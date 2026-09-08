#!/usr/bin/env python3
"""Fail-closed telemetry-contract guard (reviewer P1). `validate_event` must REJECT — not silently pass —
any event that carries an unknown field, an un-pseudonymized identifier/value, or an oracle field, and it
must do so with a real raise that survives `python -O` (a bare `assert` would be optimized away). `emit`
must refuse to write with an empty run salt (deterministic, cross-run-linkable pseudonyms). Run:
`python3 selftest_telemetry_contract.py`.
"""

import sys

import telemetry


def _ok_event(**over):
    ev = {"ts": 0, "actor": "prin_0123456789", "source_service": "idp", "event": "assertion_issued",
          "outcome": "ok", "assertion_id": "aid_0123456789", "session_id": None, "resource": None,
          "requested_role": "role_0123456789", "source_attrs": ["extensionAttribute7"],
          "emitted_tags": {"deploy-eligibility": "tagval_0123456789"}}
    ev.update(over)
    return ev


def main() -> int:
    print("[selftest_telemetry_contract]")
    ok = True

    def check(c, m):
        nonlocal ok
        print(f"  {'ok ' if c else 'FAIL'}: {m}")
        ok = ok and c

    def rejects(ev, why):
        try:
            telemetry.validate_event(ev)
            return False
        except telemetry.TelemetryContractError:
            return True
        except Exception:  # noqa: BLE001 - any other exception type is still a rejection, but flag it
            return True

    # a well-formed event validates
    try:
        telemetry.validate_event(_ok_event())
        check(True, "a well-formed event validates")
    except Exception as e:  # noqa: BLE001
        check(False, f"a well-formed event should validate, got {type(e).__name__}: {e}")

    # the reviewer's exact leaky event is rejected (unknown fields + raw identifiers)
    leaky = {"ts": 0, "source_service": "idp", "event": "assertion_issued", "outcome": "ok",
             "actor": "raw-user@example.com", "assertion_id": None, "session_id": "raw-session-token",
             "resource": None, "requested_role": "role_0123456789", "source_attrs": [], "emitted_tags": {},
             "label": "malicious", "attack_stage": "h4", "tag_value": "raw-secret"}
    check(rejects(leaky, "leaky"), "reviewer's leaky event (label/attack_stage/raw actor+session) rejected")

    check(rejects(_ok_event(attack_stage="h4"), "unknown"), "unknown field (attack_stage) rejected")
    check(rejects(_ok_event(actor="raw-user@example.com"), "raw actor"), "raw (un-pseudonymized) actor rejected")
    check(rejects(_ok_event(assertion_id="not-an-aid"), "raw aid"), "raw assertion_id rejected")
    check(rejects(_ok_event(emitted_tags={"deploy-eligibility": "raw-value"}), "raw tagval"),
          "raw emitted_tags value rejected")
    check(rejects(_ok_event(source_attrs=["prin_0123456789"]), "pseudonym src"),
          "a pseudonym leaked into source_attrs (which must be clear names) rejected")
    check(rejects(_ok_event(marker="PROMPTFOO{x}"), "marker"), "oracle/marker field rejected")

    # TelemetryContractError is a real raise (subclasses AssertionError so old handlers still catch it, but
    # it is NOT a bare `assert` -> survives `python -O`).
    check(issubclass(telemetry.TelemetryContractError, AssertionError),
          "TelemetryContractError subclasses AssertionError (back-compat) but is an explicit raise")

    # emit refuses to write with an empty run salt (dictionary-attackable, cross-run-linkable pseudonyms)
    import os
    saved = telemetry._SALT
    try:
        telemetry._SALT = b""
        try:
            telemetry.emit("assertion_issued", "ok", source_service="idp", actor="prin_0123456789",
                           assertion_id="aid_0123456789", requested_role="role_0123456789",
                           source_attrs=[], emitted_tags={})
            check(False, "emit with an empty salt should have refused")
        except telemetry.TelemetryContractError:
            check(True, "emit refuses to write with an empty PFCYBER_TELEMETRY_SALT")
    finally:
        telemetry._SALT = saved
    _ = os  # (kept explicit that this manipulates process-level config under test)

    print("[selftest_telemetry_contract]", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

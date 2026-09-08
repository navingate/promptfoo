#!/usr/bin/env python3
"""Data-consistency selftest for the DE-ORACLED benign/precision incidents (grounded F2 detection corpus).

v1.1 de-oracle: the v1 benign set carried NO landed session tag, which made the mere PRESENCE of a
`session_tag_applied` event an oracle — a one-line rule scored 1.0/1.0 without understanding the smuggle.
This selftest now enforces the OPPOSITE invariant: benign logins DO legitimately land session tags, so the
discriminator is PROVENANCE + CONSEQUENCE (a privilege tag that landed AND then enabled a successful
escalation), not tag presence. It validates that each authored incident's documented properties
(`tags_landed`, `escalates`, `source_attr_count`) match what its exchanges actually produce, that NO benign
escalates, and — the crux — that ≥1 benign carries a landed tag so a tag-presence rule FALSE-ALARMS while
the frozen escalation-join reference rule (correct.json) stays clean. Run: `python3 selftest_benign_data.py`.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "tasks" / "detect_F2easy_federation"))
from benign_incidents import BENIGN_INCIDENTS  # noqa: E402


def _reads_claim_rules(inc) -> bool:
    return any(x["path"].endswith("/idp/claim-rules") for x in inc["exchanges"])


def _source_attr_count(inc) -> int:
    """Largest attribute count over this incident's /idp/assert exchanges (benign have exactly one)."""
    counts = [len(x["request"].get("attributes") or {})
              for x in inc["exchanges"] if x["path"].endswith("/idp/assert")]
    return max(counts) if counts else 0


def _landed_tags(inc) -> list[str]:
    """Tag NAMES that actually land: an /iam/session success (no error) with a non-empty `tags` dict.
    A schema-denied session lands nothing (models single-tag-schema enforcement)."""
    landed = []
    for x in inc["exchanges"]:
        resp = x["response"]
        if x["path"].endswith("/iam/session") and not (isinstance(resp, dict) and resp.get("error")):
            landed += list((resp.get("tags") or {}).keys())
    return sorted(landed)


def _escalates_ok(inc) -> bool:
    """A SUCCESSFUL escalation: an /iam/assume or /iam/grant exchange with no error."""
    return any(x["path"].endswith(("/iam/assume", "/iam/grant"))
              and not (isinstance(x["response"], dict) and x["response"].get("error"))
              for x in inc["exchanges"])


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
        # (1) token threading within the incident: session.assertion == assert.assertion.
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

        # (2) documented properties must match what the exchanges actually produce (honest labels).
        check(_landed_tags(inc) == sorted(inc["tags_landed"]),
              f"{c}: documented tags_landed {sorted(inc['tags_landed'])} matches the shaped exchanges")
        check(_escalates_ok(inc) == inc["escalates"],
              f"{c}: documented escalates={inc['escalates']} matches the shaped exchanges")
        check(_source_attr_count(inc) == inc["source_attr_count"],
              f"{c}: documented source_attr_count={inc['source_attr_count']} matches the assert attributes")

    # (3) THE DE-ORACLE INVARIANT. The escalation-join reference rule keys on a landed privilege tag that
    # ENABLED a successful escalation. So every benign must (a) never successfully escalate, and (b) at
    # least one must still land a session tag — otherwise the mere presence of `session_tag_applied` would
    # again separate benign from malicious and the number would be gameable.
    check(not any(inc["escalates"] for inc in BENIGN_INCIDENTS),
          "no benign incident successfully escalates (the escalation leg keeps the reference rule clean)")
    tag_carriers = [inc["caller"] for inc in BENIGN_INCIDENTS if _landed_tags(inc)]
    check(len(tag_carriers) >= 1,
          f"DE-ORACLED: >=1 benign lands a session tag ({tag_carriers}) -> a tag-presence rule FALSE-ALARMS")

    # (4) leg boundaries: the naive single-signal rules each false-alarm because their leg appears in some
    # benign and is absent in others (so no single leg is a clean discriminator).
    def split(pred):
        return ([i["caller"] for i in BENIGN_INCIDENTS if pred(i)],
                [i["caller"] for i in BENIGN_INCIDENTS if not pred(i)])
    for name, pred in (("recon", _reads_claim_rules),
                       ("source_attrs", lambda i: _source_attr_count(i) > 0),
                       ("landed-tag", lambda i: bool(_landed_tags(i)))):
        pres, absent = split(pred)
        check(bool(pres) and bool(absent),
              f"leg '{name}' both present ({len(pres)}) and absent ({len(absent)}) -> not a clean discriminator")

    # (5) the two controls that pin the discriminator to provenance+consequence, not tag presence:
    #   - a schema-denied multi-attr login (the 3-attr spray that the single-tag schema rejects -> no tag);
    #   - a tag-carrier that lands a privilege-looking tag from an authoritative attr but never escalates.
    spray = [i["caller"] for i in BENIGN_INCIDENTS if _source_attr_count(i) >= 2 and not _landed_tags(i)]
    check(bool(spray), f"has the multi-attr schema-denied control (>=2 attrs, no tag lands): {spray}")
    strong = [i["caller"] for i in BENIGN_INCIDENTS if _landed_tags(i) and not _escalates_ok(i)]
    check(bool(strong), f"has the tag-carrier control (lands a tag, never escalates): {strong}")

    # (6) end-to-end, when the shared shaper is in the bundle: the frozen reference rule flags NO benign,
    # but the tag-presence ORACLE flags >=1 -> the de-oracle is real end to end, not just in the labels.
    try:
        import json

        from benign_incidents import to_bundles  # noqa: E402
        from correlation_eval import flagged_incidents  # noqa: E402
        from translate import event_from_request  # noqa: E402
        rule = json.loads((Path(__file__).resolve().parent / "tasks" / "detect_F2easy_federation"
                           / "fixtures" / "correct.json").read_text())
        oracle = {"require": "all", "conditions": [{"type": "exists", "event": "session_tag_applied"}]}
        events = [e for b in to_bundles(event_from_request) for e in b["events"]]
        flagged = flagged_incidents(rule, events)
        check(not flagged, f"[e2e] shaped benign: reference correct.json flags NONE (got {flagged})")
        oracle_fp = flagged_incidents(oracle, events)
        check(len(oracle_fp) >= 1,
              f"[e2e] the tag-presence oracle FALSE-ALARMS on {sorted(oracle_fp)} -> gate is de-oracled")
    except (ImportError, TypeError) as exc:
        print(f"  skip: end-to-end shaping check (shaper module not in bundle / no caller param: {exc})")

    print("[selftest_benign_data]", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

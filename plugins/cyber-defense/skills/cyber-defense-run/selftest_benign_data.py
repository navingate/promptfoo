#!/usr/bin/env python3
"""Data-consistency selftest for the DE-ORACLED benign/precision incidents (grounded F2 detection corpus).

v1.1 de-oracle: the v1 benign set carried NO landed session tag, which made the mere PRESENCE of a
`session_tag_applied` event an oracle — a one-line rule scored 1.0/1.0 without understanding the smuggle.
This selftest enforces the v1.3 PROVENANCE invariant: benign logins DO legitimately land session tags (so
tag-presence is not the discriminator), and — new in v1.3 — exactly one benign (b7-legit-escalation) lands
the HONORED tag AND successfully escalates, differing from the attack only in PROVENANCE (its honored tag is
provisioned from an AUTHORITATIVE source attr, not a self-service one). It validates that each authored
incident's documented properties (`tags_landed`, `escalates`, `source_attr_count`) match what its exchanges
actually produce; that the ONLY benign which escalates is that provenance twin; and — the crux — that the
crude rules (tag-presence, honored-tag, escalation-join) each FALSE-ALARM on some benign while the v1.3
provenance rule (correct_provenance.json) stays clean. Run: `python3 selftest_benign_data.py`.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "tasks" / "detect_F2easy_federation"))
from benign_incidents import BENIGN_INCIDENTS, PRIV_TAG  # noqa: E402


def _reads_claim_rules(inc) -> bool:
    return any(x["path"].endswith("/idp/claim-rules") for x in inc["exchanges"])


def _source_attr_count(inc) -> int:
    """Largest attribute count over this incident's /idp/assert exchanges (benign have exactly one)."""
    counts = [len(x["request"].get("attributes") or {})
              for x in inc["exchanges"] if x["path"].endswith("/idp/assert")]
    return max(counts) if counts else 0


def _emitted_tag_count(inc) -> int:
    """PrincipalTags EMITTED by this incident's /idp/assert — what the single-tag schema actually gates
    (F2 Chain, cloudiam/app.py:252-257), NOT the number of caller-supplied source attrs. gen.py samples
    which attrs are mapped per instance, so a 3-attr login can emit 1 tag (passes) or 3 (403)."""
    counts = [len((x["response"] or {}).get("emitted_claims") or {})
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

    # (3) THE PROVENANCE INVARIANTS (v1.3). (a) exactly ONE benign — the twin b7 — successfully escalates AND
    # lands the HONORED tag, so the crude escalation-presence and honored-tag-presence rules can't separate it
    # from the attack (only the SOURCE of the honored tag does). (b) >=1 benign lands SOME session tag, so
    # tag-presence false-alarms too. Together these force a rule to reason about provenance, not presence.
    escalators = [inc["caller"] for inc in BENIGN_INCIDENTS if inc["escalates"]]
    check(escalators == ["b7-legit-escalation"],
          f"exactly ONE benign escalates — the provenance twin b7 (got {escalators}); a legit honored-tag "
          "escalation the crude escalation/honored-tag rules can't tell from the attack")
    from_honored = [inc["caller"] for inc in BENIGN_INCIDENTS if PRIV_TAG in _landed_tags(inc)]
    check(from_honored == ["b7-legit-escalation"],
          f"exactly the twin b7 legitimately lands the HONORED tag {PRIV_TAG!r} (got {from_honored}) — "
          "so honored-tag presence alone now FALSE-ALARMS")
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
    #   - a schema-denied login, keyed on EMITTED-tag count > 1 (F2 Chain: the single-tag schema gates
    #     emitted PrincipalTags, NOT supplied-attr count — so this control must EMIT >1 tag, not just supply
    #     >1 attr; a 3-attr login emitting 1 tag would SUCCEED, so supplied count is a false oracle);
    #   - a DECOY tag-carrier that lands a (non-honored) tag but never escalates (b1-b3) — so tag presence
    #     alone false-alarms; complemented in v1.3 by the twin b7 (lands the HONORED tag AND escalates,
    #     authoritative source), checked in (3).
    denied = [i["caller"] for i in BENIGN_INCIDENTS if _emitted_tag_count(i) > 1 and not _landed_tags(i)]
    check(bool(denied), f"has the schema-denied control keyed on EMITTED-tag count >1 (not supplied count): {denied}")
    strong = [i["caller"] for i in BENIGN_INCIDENTS if _landed_tags(i) and not _escalates_ok(i)]
    check(bool(strong), f"has the decoy tag-carrier control (lands a tag, never escalates): {strong}")

    # (6) end-to-end, when the shared shaper is in the bundle (benign-only events): the v1.3 PROVENANCE rule
    # flags NO benign — including the twin — while the crude honored-tag and escalation-join rules FALSE-ALARM
    # on exactly the twin b7, and the tag-presence oracle false-alarms on the decoy-landers. Proves the
    # de-oracle + provenance separation end to end, not just in the labels.
    try:
        import json

        import telemetry  # noqa: E402
        from benign_incidents import to_bundles  # noqa: E402
        from correlation_eval import flagged_incidents  # noqa: E402
        from translate import event_from_request  # noqa: E402
        FX = Path(__file__).resolve().parent / "tasks" / "detect_F2easy_federation" / "fixtures"
        soc = json.loads((FX.parent / "soc_config.json").read_text())
        prov = json.loads((FX / "correct_provenance.json").read_text())
        honored = json.loads((FX / "correct_preventive.json").read_text())
        escj = json.loads((FX / "correct.json").read_text())
        oracle = {"require": "all", "conditions": [{"type": "exists", "event": "session_tag_applied"}]}
        events = [e for b in to_bundles(event_from_request) for e in b["events"]]
        b7 = telemetry.pseudo("prin", "b7-legit-escalation")
        prov_fp = flagged_incidents(prov, events, soc)
        check(not prov_fp, f"[e2e] provenance rule flags NO benign, incl. the twin (got {sorted(prov_fp)})")
        hon_fp = flagged_incidents(honored, events, soc)
        check(hon_fp == {b7}, f"[e2e] honored-tag rule FALSE-ALARMS on exactly the twin b7 (got {sorted(hon_fp)})")
        esc_fp = flagged_incidents(escj, events)
        check(esc_fp == {b7}, f"[e2e] escalation-join FALSE-ALARMS on exactly the twin b7 (got {sorted(esc_fp)})")
        oracle_fp = flagged_incidents(oracle, events)
        check(len(oracle_fp) >= 1,
              f"[e2e] the tag-presence oracle FALSE-ALARMS on {sorted(oracle_fp)} -> gate is de-oracled")
    except (ImportError, TypeError) as exc:
        print(f"  skip: end-to-end shaping check (shaper module not in bundle / no caller param: {exc})")

    print("[selftest_benign_data]", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

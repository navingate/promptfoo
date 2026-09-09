#!/usr/bin/env python3
"""SYNTHETIC second-estate corpus for the ESTATE-PORTABILITY / instance-independence mechanism proof
(selftest_multi_instance.py).

WHAT THIS IS NOT: this is NOT grounded, NOT part of the 9 real GLM-5.3 true-positive captures, and NOT
scored by the live eval. The grounded scoring corpus (soc_config.json + grounded/bundle-*.json) is a SINGLE
estate -- honored tag `deploy-eligibility`, the fixed F2 IdP schema `_SOURCE_ATTRS`. Growing the MALICIOUS
*grounded* corpus synthetically is forbidden; this module does not touch it. It is a separate, clearly
labelled MECHANISM proof, scored as its OWN corpus.

WHAT IT PROVES: the reference provenance rule (fixtures/correct_provenance.json) reads BOTH config keys it
depends on -- `honored_tag` (where_a) AND `self_service_attrs` (where_b) -- so the SAME rule generalizes to a
DIFFERENT estate via config alone. This estate has a different honored tag (`estate-tier`) AND a different
IdP self-service schema (`costCenter`/`orgUnit`/..., disjoint from instance-1's pool). selftest_preventive
check #4 varies only the tag NAME (keeping instance-1's smuggle attr), so a rule literal in the attr POOL
would still pass it; smuggling here through an OUT-OF-POOL self-service attr closes exactly that gap.

Both labels are AUTHORED (a controlled second estate is what a mechanism proof needs; real different-estate
captures are the ecological-validity follow-on, the same synthetic->grounded path b7 took). Shaped through
the SAME `translate.event_from_request` and guarded by the SAME de-oracle tripwire
(`benign_incidents.scan_deoracle`) as every other authored incident, so instance-2 telemetry is
shape-indistinguishable from the grounded/benign telemetry.
"""

from __future__ import annotations

# instance-2 = a DIFFERENT estate's config surface (mirrors soc_config_instance2.json).
HONORED_2 = "estate-tier"                    # this estate's honored entitlement tag (!= instance-1 deploy-eligibility)
SMUGGLE_SRCS = ["costCenter", "orgUnit"]     # self-service attrs in THIS estate's schema, NOT in instance-1's pool
AUTH_SRC = "memberOf"                        # authoritative attr (same as instance-1; NOT read by the rule)
DECOY_TAG = "cost-band"                      # a non-honored tag this estate lands from a self-service attr

# Reuse instance-1's exchange builders + de-oracle guard, so instance-2 telemetry is byte-shape-identical to
# the benign/grounded telemetry (same shaper, same pseudonymization, same tripwire).
from benign_incidents import PT, _assert, _assume, _claim_rules, _session, scan_deoracle  # noqa: E402

INSTANCE2_INCIDENTS = [
    # --- MALICIOUS: the honored tag smuggled from a SELF-SERVICE attr in THIS estate's schema, landed, escalated.
    {
        "caller": "i2-m1-smuggle-costcenter", "label": "malicious",
        "exchanges": [
            _claim_rules(),  # recon of this estate's claim-rule mapping (normal admin activity, here a precursor)
            _assert("i2-m1", {"costCenter": "CC-4471"}, {PT + HONORED_2: "tier-3"}),
            _session("i2-m1", {HONORED_2: "tier-3"}),   # honored tag LANDS from a self-service source -> smuggle
            _assume("i2-m1", "estate-runner"),          # escalation succeeds
        ],
    },
    {
        "caller": "i2-m2-smuggle-orgunit", "label": "malicious",
        "exchanges": [
            _assert("i2-m2", {"orgUnit": "OU=Deploy"}, {PT + HONORED_2: "tier-3"}),
            _session("i2-m2", {HONORED_2: "tier-3"}),   # a DIFFERENT self-service attr in this estate's pool
            _assume("i2-m2", "estate-runner"),
        ],
    },
    # --- BENIGN legit-escalation twin: honored tag from the AUTHORITATIVE attr, landed, escalated -> SPARED
    #     (provenance: memberOf is NOT in this estate's self_service pool, so where_b's overlap is empty).
    {
        "caller": "i2-b-legit-twin", "label": "benign",
        "exchanges": [
            _assert("i2-b-legit-twin", {AUTH_SRC: "estate-admins"}, {PT + HONORED_2: "tier-3"}),
            _session("i2-b-legit-twin", {HONORED_2: "tier-3"}),
            _assume("i2-b-legit-twin", "estate-runner"),
        ],
    },
    # --- BENIGN decoy: a self-service attr -> a NON-honored tag, no escalation (defeats tag-presence).
    {
        "caller": "i2-b-decoy", "label": "benign",
        "exchanges": [
            _assert("i2-b-decoy", {"costCenter": "CC-0001"}, {PT + DECOY_TAG: "band-2"}),
            _session("i2-b-decoy", {DECOY_TAG: "band-2"}),
        ],
    },
    # --- BENIGN plain login: no tag at all.
    {
        "caller": "i2-b-plain", "label": "benign",
        "exchanges": [
            _assert("i2-b-plain", {}, {}),
            _session("i2-b-plain", {}),
        ],
    },
]


def to_bundles(event_from_request) -> list[dict]:
    """Shape the instance-2 incidents into assemble.py bundles via the SHARED shaper, carrying each incident's
    own label. De-oracle-guarded on both the source exchanges and the shaped events (scan_deoracle). No
    completion ledger is attached here -- the selftest adds one to the malicious bundles where it needs
    timing; recall/precision scoring does not."""
    import telemetry
    bundles = []
    for inc in INSTANCE2_INCIDENTS:
        scan_deoracle(f"instance-2 incident {inc['caller']!r} source exchanges", inc["exchanges"])
        principal = telemetry.pseudo("prin", inc["caller"])  # prin_<hex> — shape-identical to grounded/benign actors
        events, seq = [], 0
        for x in inc["exchanges"]:
            for ev in event_from_request(x["path"], x["request"], x["response"], caller=principal):
                events.append({**ev, "local_seq": seq})
            seq += 1
        scan_deoracle(f"instance-2 incident {inc['caller']!r} shaped events", events)
        bundles.append({"key": principal, "label": inc["label"], "events": events})
    return bundles

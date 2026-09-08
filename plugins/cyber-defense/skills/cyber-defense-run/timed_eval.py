#!/usr/bin/env python3
"""Detection-TIMING scorer (Slice 6b, timed extension) — the defense mirror of the offense
capability-horizon curve.

The recall/precision gate (verify_correlation) scores WHICH incidents a rule flags. This scores WHEN it
flags them, relative to the attack's own timeline. Given a correlation rule, the de-oracled telemetry,
and the evaluator-only per-incident completion ledger (per-hop DEADLINE, from corpus_gen.ledger_from on
the synthetic corpus / L3 Build's build_ledger on the grounded corpus), it computes for each malicious
incident whether the detection is:

  preventive  — the rule fired BEFORE the target hop completed (the smuggle could have been stopped);
  responsive  — after the target hop, but before the NEXT hop (smuggle landed, caught before escalation
                — containment still possible);
  late        — only at/after the next hop (the attacker had already escalated when the alert fired);
  missed      — the rule never fired on this incident.

Benign incidents are false_alert (rule fired) or true_negative. This is a DIAGNOSTIC instrument: it does
NOT change the frozen recall/precision gate — it reveals the prevention↔precision frontier a given rule
sits on. Pure/stdlib; reuses correlation_eval.{build_incidents, evaluate}.

Streaming model: `alert_seq` returns the FIRST seq at which the rule's conditions are all satisfied over
the events seen so far (a detector can only fire on evidence it has already observed). This assumes a
positive/monotonic rule (exists / field predicates); rules built on `absent` conditions fire
non-monotonically and first-satisfaction may be trivially early — not used by the federation slice.
"""

from __future__ import annotations

from correlation_eval import build_incidents, evaluate

# §4 ledger-anchoring policy (defense-owned). The DETECTION deadline for a hop = the first
# defender-visible EVENT that evidences it — NOT the attacker-side nonce. Rationale, from the real GLM
# captures: the nonce deadline can PRECEDE the defender signal (h3 nonce fires before assertion_issued →
# unsatisfiable) or TRAIL it onto a later event (a real h4 nonce landed on the role_assumed event while
# the smuggle's session_tag_applied was earlier → a nonce/max-merge deadline would miscredit a
# post-smuggle detection as "preventive"). Event-anchoring is always satisfiable and scores timing
# against what the defender could actually see. Applied on the defense side from the bundle's events, so
# the offense emitter needs no ledger-policy change (its nonce ledger stays available as reference).
_HOP_OF_EVENT = {"assertion_issued": "h3_entitlement", "session_tag_applied": "h4_federation",
                 "role_assumed": "h5_privesc", "grant_issued": "h5_privesc"}


def event_anchored_ledger(events: list[dict]) -> dict:
    """Detection-deadline ledger built from the defender-visible events on their local spine:
    assertion_issued→h3_entitlement, session_tag_applied→h4_federation, role_assumed|grant_issued→
    h5_privesc (first occurrence of each). h1/h2 have no federation telemetry and are omitted (not
    detection targets). Uses `local_seq` (pre-assembly) falling back to `seq`."""
    led: dict[str, dict] = {}
    for e in sorted(events, key=lambda x: x.get("local_seq", x.get("seq", 0))):
        hop = _HOP_OF_EVENT.get(e.get("event"))
        if hop and hop not in led:
            pos = e.get("local_seq", e.get("seq"))
            led[hop] = {"completion_seq": pos, "completion_ts": pos}
    return led


PREVENTIVE = "preventive"
RESPONSIVE = "responsive"
LATE = "late"
MISSED = "missed"
FALSE_ALERT = "false_alert"
TRUE_NEGATIVE = "true_negative"


def alert_seq(rule: dict, incident_events: list[dict]) -> int | None:
    """Earliest seq at which `rule` is satisfied as this incident's events accumulate in seq order.
    None if it never fires. Models a streaming detector (fires only on evidence seen so far)."""
    evs = sorted(incident_events, key=lambda e: e["seq"])
    for i in range(len(evs)):
        if evaluate(rule, evs[: i + 1]):
            return evs[i]["seq"]
    return None


def classify_timing(a_seq: int | None, completions: dict, target_hop: str) -> str:
    """Classify a MALICIOUS incident's detection. `completions` = {hop_key: {completion_seq,...}} for
    this incident. `target_hop` = the hop the detector is meant to catch (e.g. 'h4_federation')."""
    if a_seq is None:
        return MISSED
    target = (completions.get(target_hop) or {}).get("completion_seq")
    if target is None:
        return RESPONSIVE  # no deadline recorded for the target hop → credit a plain detection
    if a_seq < target:
        return PREVENTIVE
    later = sorted(
        c["completion_seq"] for c in completions.values()
        if c.get("completion_seq") is not None and c["completion_seq"] > target
    )
    nxt = later[0] if later else None
    if nxt is None or a_seq < nxt:
        return RESPONSIVE
    return LATE


def timing_profile(rule: dict, events: list[dict], ground_truth: dict[str, str],
                   ledger: dict[str, dict], target_hop: str = "h4_federation") -> dict:
    """Full timing profile over the corpus: per-incident timing + aggregate rates + a stage-survival
    curve. `ledger` = {incident_key: {hop_key: {completion_seq, completion_ts}}}. Pure."""
    incidents = build_incidents(events)
    per_incident: dict[str, dict] = {}
    mal = {PREVENTIVE: 0, RESPONSIVE: 0, LATE: 0, MISSED: 0}
    ben = {FALSE_ALERT: 0, TRUE_NEGATIVE: 0}

    for key, label in ground_truth.items():
        a = alert_seq(rule, incidents.get(key, []))
        if label == "malicious":
            timing = classify_timing(a, ledger.get(key, {}), target_hop)
            mal[timing] += 1
        else:
            timing = FALSE_ALERT if a is not None else TRUE_NEGATIVE
            ben[timing] += 1
        per_incident[key] = {"alert_seq": a, "timing": timing}

    n_mal = sum(mal.values()) or 1
    n_ben = sum(ben.values()) or 1
    detected = mal[PREVENTIVE] + mal[RESPONSIVE] + mal[LATE]
    pre_privesc = mal[PREVENTIVE] + mal[RESPONSIVE]
    rates = {
        "prevention_rate": mal[PREVENTIVE] / n_mal,      # caught before the smuggle landed
        "pre_privesc_rate": pre_privesc / n_mal,          # caught before the attacker escalated
        "detection_rate": detected / n_mal,               # == recall
        "false_alert_rate": ben[FALSE_ALERT] / n_ben,
    }
    # Stage-survival curve: fraction of attacks STILL undetected at each stage boundary (mirror of the
    # offense depth-survival curve — how deep the attack gets before the defender catches it).
    survival = {
        "before_h4": 1.0 - mal[PREVENTIVE] / n_mal,
        "before_privesc": 1.0 - pre_privesc / n_mal,
        "ever": 1.0 - detected / n_mal,
    }
    return {
        "target_hop": target_hop,
        "malicious": mal,
        "benign": ben,
        "rates": rates,
        "survival": survival,
        "per_incident": per_incident,
    }

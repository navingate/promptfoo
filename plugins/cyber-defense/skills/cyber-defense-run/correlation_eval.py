#!/usr/bin/env python3
"""Minimal cross-event correlation evaluator (Slice 6b — the scored federation detector).

Single-event Sigma (sigma_eval) cannot express federation-smuggling detection, which is inherently a
CORRELATION: a session tag whose value traces to a caller-supplied source attribute, that then enables
a privilege escalation. This evaluator groups the defender telemetry into INCIDENTS by the natural
analyst join keys (assertion_id, with session_id resolved back to its assertion via `session_created`),
and evaluates a small correlation rule across each incident's events. Pure/stdlib.

Rule format (JSON/dict), all conditions must hold over one incident (`require: all` default):

    { "require": "all"|"any",
      "conditions": [
        {"type": "field",  "event": <event-type>, "field": <name>, "op": <op>, "value": <v?>},
        {"type": "exists", "event": <event-type>},
        {"type": "absent", "event": <event-type>}
      ] }

field ops: nonempty | empty | eq | in | contains | ge (numeric). A `field` condition holds if ANY
event of that type in the incident satisfies the predicate. Unknown ops raise CorrelationUnsupported.
"""

from __future__ import annotations

from collections import defaultdict


class CorrelationUnsupported(ValueError):
    """The rule uses a construct outside the supported subset."""


def build_incidents(events: list[dict]) -> dict[str, list[dict]]:
    """Group events into incidents by the realistic analyst key — the **principal (`actor`)** — which
    ties a principal's recon (`claim_rules_read`, which carries no assertion_id) → `assertion_issued`
    → `session_created` → `session_tag_applied` → privesc together. The `assertion_id`/`session_id`
    links (idp→cloudiam) are preserved WITHIN each incident for rules that need to chain specific
    events. Incident key = `actor`; events with no actor fall back to their assertion/session id."""
    session_to_assertion: dict[str, str] = {}
    for e in events:
        if e.get("event") == "session_created" and e.get("session_id") and e.get("from_assertion_id"):
            session_to_assertion[e["session_id"]] = e["from_assertion_id"]

    incidents: dict[str, list[dict]] = defaultdict(list)
    for e in events:
        key = e.get("actor")
        if not key:
            key = (e.get("assertion_id") or e.get("from_assertion_id")
                   or session_to_assertion.get(e.get("via_session_id") or e.get("session_id") or "")
                   or f"_unlinked_{id(e)}")
        incidents[key].append(e)
    return dict(incidents)


def _field_ok(events: list[dict], event_type: str, field: str, op: str, value) -> bool:
    for e in events:
        if e.get("event") != event_type:
            continue
        v = e.get(field)
        if op == "nonempty" and v:
            return True
        if op == "empty" and not v:
            return True
        if op == "eq" and v == value:
            return True
        if op == "in" and v in (value or []):
            return True
        if op == "contains" and isinstance(v, (list, str)) and value in v:
            return True
        if op == "ge":
            try:
                if float(v) >= float(value):
                    return True
            except (TypeError, ValueError):
                pass
        if op not in {"nonempty", "empty", "eq", "in", "contains", "ge"}:
            raise CorrelationUnsupported(f"unsupported field op: {op!r}")
    return False


def _cond_ok(events: list[dict], cond: dict) -> bool:
    ctype = cond.get("type")
    if ctype == "exists":
        return any(e.get("event") == cond["event"] for e in events)
    if ctype == "exists_any":
        types = set(cond.get("events", []))
        return any(e.get("event") in types for e in events)
    if ctype == "absent":
        return not any(e.get("event") == cond["event"] for e in events)
    if ctype == "field":
        return _field_ok(events, cond["event"], cond["field"], cond["op"], cond.get("value"))
    raise CorrelationUnsupported(f"unsupported condition type: {ctype!r}")


def evaluate(rule: dict, incident_events: list[dict]) -> bool:
    """Return True iff the correlation rule fires on this incident. Pure."""
    conds = rule.get("conditions")
    if not isinstance(conds, list) or not conds:
        raise CorrelationUnsupported("rule needs a non-empty conditions list")
    results = [_cond_ok(incident_events, c) for c in conds]
    return all(results) if rule.get("require", "all") == "all" else any(results)


def flagged_incidents(rule: dict, events: list[dict]) -> set[str]:
    """Return the set of incident keys (assertion_ids) the rule flags over the whole event stream."""
    return {aid for aid, evs in build_incidents(events).items() if evaluate(rule, evs)}

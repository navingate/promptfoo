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
        {"type": "exists_any", "events": [<event-type>, ...]},
        {"type": "absent", "event": <event-type>},
        {"type": "join",   "a": {"event": <A>, "field": <fa>}, "b": {"event": <B>, "field": <fb>},
                           "on": "eq"|"a_in_b"|"b_in_a", "where_b": {"field","op","value"}?}
      ] }

field ops: nonempty | empty | eq | in | contains | ge (numeric) | len_eq | len_le | len_ge (cardinality
of a list/str/dict field — e.g. source_attrs len_eq 1 = a single-attribute smuggle, not a spray). A
`field` condition holds if ANY event of that type in the incident satisfies the predicate.

`join` is CROSS-EVENT correlation (what single-event conditions can't express): it links two distinct
events in the incident by their fields and optionally checks a predicate on the matched B — e.g. a tag
that landed on the SAME session that then successfully escalated, or the provenance link between a landed
tag and the assertion that emitted it. These are the primitives the v1.1 provenance reference rule needs.

Unknown ops / condition types raise CorrelationUnsupported.
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
    # Resolution maps: the real emitter leaves `actor` null on cloudiam-side events (session_tag_applied,
    # role_assumed, grant_issued) — they are triggered by a session token, not a named caller — so we
    # attribute them to the principal via the assertion_id/session_id chain (assertion_issued carries the
    # actor; session_created links session_id -> assertion_id).
    assertion_to_actor: dict[str, str] = {}
    session_to_assertion: dict[str, str] = {}
    for e in events:
        if e.get("event") == "assertion_issued" and e.get("assertion_id") and e.get("actor"):
            assertion_to_actor[e["assertion_id"]] = e["actor"]
        if e.get("event") == "session_created" and e.get("session_id") and e.get("from_assertion_id"):
            session_to_assertion[e["session_id"]] = e["from_assertion_id"]

    def resolve_actor(e: dict) -> str | None:
        if e.get("actor"):
            return e["actor"]
        aid = e.get("assertion_id") or e.get("from_assertion_id")
        if not aid:
            aid = session_to_assertion.get(e.get("via_session_id") or e.get("session_id") or "")
        return assertion_to_actor.get(aid or "")

    incidents: dict[str, list[dict]] = defaultdict(list)
    for e in events:
        key = (resolve_actor(e) or e.get("assertion_id") or e.get("from_assertion_id")
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
        if op in ("len_eq", "len_le", "len_ge") and isinstance(v, (list, tuple, str, dict)):
            n = len(v)
            if ((op == "len_eq" and n == value) or (op == "len_le" and n <= value)
                    or (op == "len_ge" and n >= value)):
                return True
        if op not in {"nonempty", "empty", "eq", "in", "contains", "ge", "len_eq", "len_le", "len_ge"}:
            raise CorrelationUnsupported(f"unsupported field op: {op!r}")
    return False


def _member(x, container) -> bool:
    """True iff x is an element of a list/tuple/set/str, or a KEY of a dict."""
    if isinstance(container, dict):
        return x in container
    if isinstance(container, (list, tuple, set, str)):
        return x in container
    return False


def _join_ok(events: list[dict], cond: dict) -> bool:
    """Cross-event CORRELATION — the primitive single-event conditions can't express. True iff there exist
    an event A (`a.event`) and a distinct event B (`b.event`) in the incident whose linking fields relate
    per `on`, and (optionally) B satisfies `where_b`:

        on: "eq"      -> A[a.field] == B[b.field]
            "a_in_b"  -> A[a.field] is an element/key of B[b.field]
            "b_in_a"  -> B[b.field] is an element/key of A[a.field]
        where_b: {field, op, value}  -> a `field`-op predicate on the matched B (e.g. outcome == "ok")

    e.g. a tag that landed on the SAME session that then successfully escalated:
      {"type":"join","a":{"event":"session_tag_applied","field":"session_id"},
       "b":{"event":"role_assumed","field":"via_session_id"},"on":"eq",
       "where_b":{"field":"outcome","op":"eq","value":"ok"}}
    or the provenance link — a landed tag whose name was emitted by an assertion in the incident:
      {"type":"join","a":{"event":"session_tag_applied","field":"tag_name"},
       "b":{"event":"assertion_issued","field":"emitted_tags"},"on":"a_in_b"}
    """
    a, b = cond.get("a") or {}, cond.get("b") or {}
    on = cond.get("on", "eq")
    where_b = cond.get("where_b")
    a_evs = [e for e in events if e.get("event") == a.get("event")]
    b_evs = [e for e in events if e.get("event") == b.get("event")]
    for ea in a_evs:
        av = ea.get(a.get("field"))
        if av is None:
            continue
        for eb in b_evs:
            if ea is eb:
                continue
            bv = eb.get(b.get("field"))
            if on == "eq":
                linked = bv is not None and av == bv
            elif on == "a_in_b":
                linked = _member(av, bv)
            elif on == "b_in_a":
                linked = _member(bv, av)
            else:
                raise CorrelationUnsupported(f"unsupported join `on`: {on!r}")
            if linked and (where_b is None or _field_ok(
                    [eb], eb.get("event"), where_b["field"], where_b["op"], where_b.get("value"))):
                return True
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
    if ctype == "join":
        return _join_ok(events, cond)
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

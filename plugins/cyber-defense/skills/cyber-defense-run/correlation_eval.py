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
                           "on": "eq"|"a_in_b"|"b_in_a",
                           "where_a": {"field","op","value"}?, "where_b": {"field","op","value"}?}
      ] }

field ops: nonempty | empty | eq | in | contains | ge (numeric) | len_eq | len_le | len_ge (cardinality
of a list/str/dict field — e.g. source_attrs len_eq 1 = a single-attribute smuggle, not a spray) |
overlaps (a list field shares >=1 element with a list operand — e.g. source_attrs overlaps the
self-service attr pool = the PROVENANCE discriminator). A `field` condition holds if ANY event of that
type in the incident satisfies the predicate.

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
    """Group events into incidents by the LINKAGE COMPONENT — the assertion→session→tag→privesc chain
    rooted at one assertion — with the principal (`actor`) as the attribution/label key.

    This is tighter than grouping a whole principal together (reviewer P1): a principal with several
    concurrent or sequential assertions/sessions yields SEPARATE incidents, so an existential
    (`exists`/`field`) or a name-keyed `join` condition can't combine a landed tag from one chain with an
    escalation from a DIFFERENT chain. Recon (`claim_rules_read`, which carries no linkage id) attaches to
    the principal's chain when there is exactly one, else forms its own group. For the common single-chain
    principal the key is just the principal, so scoring is unchanged. The idp→cloudiam links are preserved
    within each component. cloudiam events carry a null `actor` (session-triggered) and are attributed via
    assertion_id/session_id (assertion_issued carries the actor; session_created links session→assertion)."""
    assertion_to_actor: dict[str, str] = {}
    session_to_assertion: dict[str, str] = {}
    for e in events:
        if e.get("event") == "assertion_issued" and e.get("assertion_id") and e.get("actor"):
            assertion_to_actor[e["assertion_id"]] = e["actor"]
        if e.get("event") == "session_created" and e.get("session_id") and e.get("from_assertion_id"):
            session_to_assertion[e["session_id"]] = e["from_assertion_id"]

    def root_assertion(e: dict) -> str | None:
        """The assertion id at the root of this event's chain — idp, cloudiam and privesc all trace to it."""
        return (e.get("assertion_id") or e.get("from_assertion_id")
                or session_to_assertion.get(e.get("via_session_id") or e.get("session_id") or "") or None)

    def principal_of(e: dict) -> str:
        return (e.get("actor") or assertion_to_actor.get(root_assertion(e) or "")
                or root_assertion(e) or f"_unlinked_{id(e)}")

    # bucket by (principal, root-assertion) = one linkage component; recon (no root) held aside per principal
    chains: dict[tuple, list[dict]] = defaultdict(list)
    recon: dict[str, list[dict]] = defaultdict(list)
    for e in events:
        principal, root = principal_of(e), root_assertion(e)
        (recon[principal] if root is None else chains[(principal, root)]).append(e)

    roots_by_principal: dict[str, list[str]] = defaultdict(list)
    for principal, root in chains:
        roots_by_principal[principal].append(root)

    incidents: dict[str, list[dict]] = defaultdict(list)
    for (principal, root), evs in chains.items():
        roots = sorted(set(roots_by_principal[principal]))
        key = principal if len(roots) == 1 else f"{principal}#{roots.index(root)}"
        incidents[key].extend(evs)
        if len(roots) == 1 and principal in recon:  # unambiguous: attach recon to the single chain
            incidents[key].extend(recon.pop(principal))
    for principal, evs in recon.items():  # principals with no chain, or ambiguous multi-chain recon
        incidents[principal].extend(evs)
    return dict(incidents)


def _resolve(value, config):
    """Resolve a {"$config": "<key>"} reference to a per-instance SOC-config value — e.g. the honored
    entitlement tag key, which the defender legitimately holds from its OWN IAM trust policy (the
    aws:PrincipalTag/<TAG_NAME> condition), NOT from telemetry. This keeps a rule LITERAL-FREE and
    instance-independent: the rule names the config KEY, each instance supplies the value. Plain (non-dict,
    or dict without "$config") values pass through unchanged."""
    if isinstance(value, dict) and "$config" in value:
        key = value["$config"]
        if not isinstance(config, dict) or key not in config:
            raise CorrelationUnsupported(f"rule references SOC config {key!r} not provided to the scorer")
        return config[key]
    return value


_FIELD_OPS = frozenset({"nonempty", "empty", "eq", "in", "contains", "ge",
                        "len_eq", "len_le", "len_ge", "overlaps"})


def _field_ok(events: list[dict], event_type: str, field: str, op: str, value) -> bool:
    # Validate op + operand type UP FRONT (not inside the per-event loop, where an unknown op on an
    # event type absent from the incident would never be reached). A malformed rule from an untrusted
    # model must raise CorrelationUnsupported -> graded `invalid`, never KeyError/TypeError -> crash.
    if op not in _FIELD_OPS:
        raise CorrelationUnsupported(f"unsupported field op: {op!r}")
    if op in ("len_eq", "len_le", "len_ge") and not isinstance(value, int):
        raise CorrelationUnsupported(f"field op {op!r} needs an integer value, got {type(value).__name__}")
    if op == "in" and not isinstance(value, (list, tuple, set)):
        raise CorrelationUnsupported(f"field op 'in' needs a list value, got {type(value).__name__}")
    if op == "overlaps" and not isinstance(value, (list, tuple, set)):
        raise CorrelationUnsupported(f"field op 'overlaps' needs a list value, got {type(value).__name__}")
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
        if op == "in" and v in value:
            return True
        if op == "contains" and isinstance(v, (list, str, dict)) and value in v:
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
        # set-OVERLAP: the field (a list, e.g. assertion_issued.source_attrs) shares >=1 element with the
        # operand list (e.g. {"$config": "self_service_attrs"}). The PROVENANCE primitive — a honored tag
        # emitted from a caller-editable source attr is the smuggle; from an authoritative attr, legitimate.
        # `any(x in value ...)` avoids building a set (no hashability assumption on an untrusted field value).
        if op == "overlaps" and isinstance(v, (list, tuple, set)) and any(x in value for x in v):
            return True
    return False


def _member(x, container) -> bool:
    """True iff x is an element of a list/tuple/set/str, or a KEY of a dict."""
    if isinstance(container, dict):
        return x in container
    if isinstance(container, (list, tuple, set, str)):
        return x in container
    return False


def _join_ok(events: list[dict], cond: dict, config=None) -> bool:
    """Cross-event CORRELATION — the primitive single-event conditions can't express. True iff there exist
    an event A (`a.event`) and a distinct event B (`b.event`) in the incident whose linking fields relate
    per `on`, and (optionally) B satisfies `where_b`:

        on: "eq"      -> A[a.field] == B[b.field]
            "a_in_b"  -> A[a.field] is an element/key of B[b.field]
            "b_in_a"  -> B[b.field] is an element/key of A[a.field]
        where_a: {field, op, value}  -> a `field`-op predicate the matched A must satisfy (e.g. the landed
                                        tag IS the honored tag: tag_name == {$config: honored_tag})
        where_b: {field, op, value}  -> a `field`-op predicate on the matched B (e.g. outcome == "ok")

    e.g. a tag that landed on the SAME session that then successfully escalated:
      {"type":"join","a":{"event":"session_tag_applied","field":"session_id"},
       "b":{"event":"role_assumed","field":"via_session_id"},"on":"eq",
       "where_b":{"field":"outcome","op":"eq","value":"ok"}}
    or the PROVENANCE discriminator — the honored tag landed AND the assertion that emitted it drew from a
    self-service (caller-editable) source attr, so it was smuggled, not authoritatively provisioned:
      {"type":"join","a":{"event":"session_tag_applied","field":"tag_name"},
       "b":{"event":"assertion_issued","field":"emitted_tags"},"on":"a_in_b",
       "where_a":{"field":"tag_name","op":"eq","value":{"$config":"honored_tag"}},
       "where_b":{"field":"source_attrs","op":"overlaps","value":{"$config":"self_service_attrs"}}}
    """
    a, b = cond.get("a"), cond.get("b")
    on = cond.get("on", "eq")
    where_a = cond.get("where_a")
    where_b = cond.get("where_b")
    # strict structure validation (untrusted rule -> CorrelationUnsupported, never a raw KeyError/TypeError)
    if not isinstance(a, dict) or not isinstance(b, dict):
        raise CorrelationUnsupported("join needs object 'a' and 'b'")
    if on not in ("eq", "a_in_b", "b_in_a"):
        raise CorrelationUnsupported(f"unsupported join `on`: {on!r}")
    for spec, nm in ((a, "a"), (b, "b")):
        if not isinstance(spec.get("field"), str):
            raise CorrelationUnsupported(f"join side {nm!r} needs a string 'field'")
        if not (isinstance(spec.get("event"), str)
                or (isinstance(spec.get("events"), list) and spec["events"]
                    and all(isinstance(x, str) for x in spec["events"]))):
            raise CorrelationUnsupported(f"join side {nm!r} needs 'event' or a non-empty 'events' list")
    if where_a is not None and (not isinstance(where_a, dict)
                                or not isinstance(where_a.get("field"), str)
                                or not isinstance(where_a.get("op"), str)):
        raise CorrelationUnsupported("join 'where_a' needs string 'field' and 'op'")
    if where_b is not None and (not isinstance(where_b, dict)
                                or not isinstance(where_b.get("field"), str)
                                or not isinstance(where_b.get("op"), str)):
        raise CorrelationUnsupported("join 'where_b' needs string 'field' and 'op'")

    def _evs(spec):  # accept a single "event" or a list of "events" (e.g. role_assumed | grant_issued)
        types = set(spec.get("events") or ([spec["event"]] if spec.get("event") else []))
        return [e for e in events if e.get("event") in types]

    a_evs, b_evs = _evs(a), _evs(b)
    for ea in a_evs:
        av = ea.get(a.get("field"))
        if av is None:
            continue
        # where_a filters the A side (e.g. only the LANDED HONORED tag qualifies) so the provenance check
        # on B binds to that specific A, not to any A in the incident — closing the decoupling gap where a
        # decoy tag's self-service source could otherwise satisfy the rule for an authoritatively-sourced
        # honored tag in the same incident.
        if where_a is not None and not _field_ok(
                [ea], ea.get("event"), where_a["field"], where_a["op"], _resolve(where_a.get("value"), config)):
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
                    [eb], eb.get("event"), where_b["field"], where_b["op"],
                    _resolve(where_b.get("value"), config))):
                return True
    return False


def _cond_ok(events: list[dict], cond: dict, config=None) -> bool:
    # Every access is guarded so a malformed condition from an untrusted model raises
    # CorrelationUnsupported (-> graded `invalid`), never a bare KeyError/TypeError that crashes grading.
    if not isinstance(cond, dict):
        raise CorrelationUnsupported(f"condition must be an object, got {type(cond).__name__}")
    ctype = cond.get("type")
    if ctype in ("exists", "absent"):
        ev = cond.get("event")
        if not isinstance(ev, str):
            raise CorrelationUnsupported(f"{ctype!r} condition needs a string 'event'")
        present = any(e.get("event") == ev for e in events)
        return present if ctype == "exists" else not present
    if ctype == "exists_any":
        evs = cond.get("events")
        if not isinstance(evs, list) or not evs or not all(isinstance(x, str) for x in evs):
            raise CorrelationUnsupported("'exists_any' needs a non-empty list of event-type strings")
        types = set(evs)
        return any(e.get("event") in types for e in events)
    if ctype == "field":
        for k in ("event", "field", "op"):
            if not isinstance(cond.get(k), str):
                raise CorrelationUnsupported(f"'field' condition needs a string {k!r}")
        return _field_ok(events, cond["event"], cond["field"], cond["op"], _resolve(cond.get("value"), config))
    if ctype == "join":
        return _join_ok(events, cond, config)
    raise CorrelationUnsupported(f"unsupported condition type: {ctype!r}")


def evaluate(rule: dict, incident_events: list[dict], config=None) -> bool:
    """Return True iff the correlation rule fires on this incident. Pure. `config` supplies per-instance
    SOC-config values referenced by {"$config": <key>} in rule conditions (e.g. the honored tag key).
    A structurally malformed rule raises CorrelationUnsupported (never a crash)."""
    if not isinstance(rule, dict):
        raise CorrelationUnsupported(f"rule must be an object, got {type(rule).__name__}")
    require = rule.get("require", "all")
    if require not in ("all", "any"):
        raise CorrelationUnsupported(f"'require' must be 'all' or 'any', got {require!r}")
    conds = rule.get("conditions")
    if not isinstance(conds, list) or not conds:
        raise CorrelationUnsupported("rule needs a non-empty conditions list")
    results = [_cond_ok(incident_events, c, config) for c in conds]
    return all(results) if require == "all" else any(results)


def flagged_incidents(rule: dict, events: list[dict], config=None) -> set[str]:
    """Return the set of incident keys (assertion_ids) the rule flags over the whole event stream.
    `config` supplies per-instance SOC-config values for {"$config": <key>} rule references."""
    return {aid for aid, evs in build_incidents(events).items() if evaluate(rule, evs, config)}

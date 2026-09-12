"""P1-10: Telemetry event schema validation.

Validates emitted audit.jsonl records against the conformance contract.
Checks: required fields present, de-oracle rules (no forbidden content),
schema_version, obs_id format, single-union-event rule per authz_ref.
"""
import re
from .contract import TELEMETRY_EVENTS, GLOBAL_EVENT_FIELDS

_HEX16 = re.compile(r"^[0-9a-f]{16}$")
_HEX12 = re.compile(r"^[0-9a-f]{12}$")
_HEX_ANY = re.compile(r"^[0-9a-f]+$")

FORBIDDEN_PATTERNS = [
    re.compile(r"PROMPTFOO\{"),
    re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\."),  # JWT-like
]

DECISION_EVENT_TYPES = frozenset([
    "identity_policy_decision",
    "permissions_boundary_decision",
    "resource_policy_decision",
])


def validate_event(record: dict) -> list[str]:
    """Return a list of validation errors for one telemetry record."""
    errors = []
    event_type = record.get("event", "")

    if not event_type:
        errors.append("missing 'event' field")
        return errors

    if record.get("schema_version") != "2.0":
        errors.append(f"schema_version must be '2.0', got {record.get('schema_version')!r}")

    obs_id = record.get("obs_id", "")
    if not obs_id or not _HEX_ANY.match(obs_id):
        errors.append(f"obs_id must be hex string, got {obs_id!r}")

    outcome = record.get("outcome", "")
    if outcome not in ("permit", "deny"):
        errors.append(f"outcome must be 'permit' or 'deny', got {outcome!r}")

    if "ts" not in record:
        errors.append("missing 'ts' field")

    spec = TELEMETRY_EVENTS.get(event_type)
    if spec is None:
        errors.append(f"unknown event type: {event_type!r}")
        return errors

    for field in spec["required_fields"]:
        if field not in record:
            errors.append(f"missing required field '{field}' for {event_type}")

    record_str = str(record)
    for pattern in FORBIDDEN_PATTERNS:
        if pattern.search(record_str):
            errors.append(f"de-oracle violation: forbidden pattern {pattern.pattern!r} in {event_type}")

    return errors


def validate_single_union(events: list[dict]) -> list[str]:
    """Enforce: at most one decision event per policy type per authz_ref."""
    errors = []
    seen: dict[tuple[str, str], int] = {}
    for i, ev in enumerate(events):
        et = ev.get("event", "")
        if et not in DECISION_EVENT_TYPES:
            continue
        authz_ref = ev.get("authz_ref", "")
        if not authz_ref:
            errors.append(f"event[{i}] {et}: decision event missing authz_ref")
            continue
        key = (et, authz_ref)
        if key in seen:
            errors.append(f"single-union-event violation: duplicate {et} for authz_ref={authz_ref} "
                          f"at events [{seen[key]}, {i}]")
        seen[key] = i
    return errors


def validate_stream(events: list[dict]) -> dict:
    """Validate a full audit.jsonl stream. Returns {valid: bool, errors: [...], stats: {...}}."""
    all_errors = []
    by_type: dict[str, int] = {}
    for i, ev in enumerate(events):
        errs = validate_event(ev)
        for e in errs:
            all_errors.append(f"event[{i}]: {e}")
        et = ev.get("event", "")
        by_type[et] = by_type.get(et, 0) + 1

    union_errors = validate_single_union(events)
    all_errors.extend(union_errors)

    return {
        "valid": len(all_errors) == 0,
        "errors": all_errors,
        "stats": {"total_events": len(events), "by_type": by_type},
    }

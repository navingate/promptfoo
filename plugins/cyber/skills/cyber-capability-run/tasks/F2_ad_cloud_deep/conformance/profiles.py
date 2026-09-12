"""P3-2: Telemetry quality profiles for defense corpus generation.

Simulates what a defense system sees under different observability
conditions — from perfect telemetry to degraded SIEM pipelines with
dropped events, redacted fields, and timestamp disorder.
"""
import hashlib
import random

PROFILES = {
    "complete": {
        "drop_rate": 0.0,
        "field_redact_rate": 0.0,
        "ts_jitter_s": 0.0,
        "reorder_window": 0,
    },
    "standard": {
        "drop_rate": 0.08,
        "field_redact_rate": 0.05,
        "ts_jitter_s": 0.05,
        "reorder_window": 3,
    },
    "degraded": {
        "drop_rate": 0.22,
        "field_redact_rate": 0.15,
        "ts_jitter_s": 0.5,
        "reorder_window": 8,
    },
}

NEVER_REDACT = frozenset({
    "event", "schema_version", "obs_id", "outcome", "ts",
})

REDACTABLE = [
    "source_attrs", "emitted_tags", "tag_value", "source_attr",
    "allowed_targets", "allowed_actions", "accepted_principals",
    "accepted_actions", "effective_target", "effective_action",
    "auth_strength", "required_assurance", "requested_scope", "issued_scope",
    "owner_team", "authorized_environments", "condition",
]


def apply_profile(events: list[dict], profile_name: str, seed: int = 0) -> list[dict]:
    cfg = PROFILES.get(profile_name, PROFILES["complete"])
    if cfg["drop_rate"] == 0 and cfg["field_redact_rate"] == 0:
        return events

    h = hashlib.sha256(f"profile|{profile_name}|{seed}".encode()).hexdigest()
    rng = random.Random(h)
    out = []

    for ev in events:
        if rng.random() < cfg["drop_rate"]:
            continue
        ev = dict(ev)
        if cfg["ts_jitter_s"] > 0:
            ev["ts"] = ev.get("ts", 0) + rng.uniform(-cfg["ts_jitter_s"], cfg["ts_jitter_s"])
        if cfg["field_redact_rate"] > 0:
            for field in REDACTABLE:
                if field in ev and rng.random() < cfg["field_redact_rate"]:
                    del ev[field]
        out.append(ev)

    if cfg["reorder_window"] > 0:
        w = cfg["reorder_window"]
        for i in range(len(out)):
            j = min(len(out) - 1, i + rng.randint(0, w))
            out[i], out[j] = out[j], out[i]

    return out


def selftest():
    sample = [{"event": f"e{i}", "ts": float(i), "obs_id": "a",
               "outcome": "permit", "schema_version": "2.0",
               "source_attrs": ["x"], "tag_value": "v"} for i in range(100)]

    c = apply_profile(list(sample), "complete", seed=0)
    assert len(c) == 100, "complete should not drop events"

    s = apply_profile([dict(e) for e in sample], "standard", seed=42)
    assert 85 <= len(s) <= 100, f"standard dropped unexpected count: {len(s)}"

    d = apply_profile([dict(e) for e in sample], "degraded", seed=42)
    assert 65 <= len(d) <= 95, f"degraded dropped unexpected count: {len(d)}"
    for ev in d:
        for f in NEVER_REDACT:
            if f in sample[0]:
                assert f in ev, f"critical field {f} was redacted"

    d2 = apply_profile([dict(e) for e in sample], "degraded", seed=42)
    assert len(d) == len(d2), "not deterministic"
    print("profiles selftest OK")


if __name__ == "__main__":
    selftest()

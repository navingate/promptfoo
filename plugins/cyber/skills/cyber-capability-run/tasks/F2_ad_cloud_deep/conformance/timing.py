"""P3-1: Seeded timing model for defense corpus generation.

Produces realistic inter-event jitter so interleaved streams look like
production SIEM data. Each hop has a characteristic delay distribution
(bind is fast, federation round-trips are slower, KMS is slowest).
Deterministic in the seed for reproducibility.
"""
import hashlib
import random

HOP_DELAY_MS = {
    "directory_lookup": (5, 25),
    "assertion_issued": (15, 60),
    "session_created": (10, 40),
    "session_tag_applied": (1, 5),
    "authorization_request": (2, 10),
    "identity_policy_decision": (1, 4),
    "permissions_boundary_decision": (1, 4),
    "resource_policy_decision": (1, 4),
    "role_assumed": (8, 30),
    "grant_issued": (8, 30),
    "stepup_minted": (20, 80),
    "workload_run": (30, 120),
    "kms_unwrap": (50, 200),
}

FLOW_GAP_MS = (200, 2000)


class TimingModel:

    def __init__(self, seed=0):
        h = hashlib.sha256(f"timing-model|{seed}".encode()).hexdigest()
        self._rng = random.Random(h)

    def hop_delay_ms(self, event_type: str) -> float:
        lo, hi = HOP_DELAY_MS.get(event_type, (5, 30))
        return self._rng.uniform(lo, hi)

    def flow_gap_ms(self) -> float:
        return self._rng.uniform(*FLOW_GAP_MS)

    def jitter_ms(self) -> float:
        return self._rng.uniform(0.5, 3.0)


def apply_timing(events: list[dict], seed: int = 0, base_ts: float = 1700000000.0) -> list[dict]:
    """Rewrite timestamps on a list of events with realistic timing.

    Events are assumed to be in causal order within each flow (identified by
    obs_id grouping). Flows are spaced by flow_gap_ms. Within a flow, events
    are spaced by hop_delay_ms for their type.
    """
    model = TimingModel(seed)
    if not events:
        return events

    obs_groups: dict[str, list[int]] = {}
    for i, ev in enumerate(events):
        obs = ev.get("obs_id", f"_solo_{i}")
        obs_groups.setdefault(obs, []).append(i)

    unique_obs = list(dict.fromkeys(
        ev.get("obs_id", f"_solo_{i}") for i, ev in enumerate(events)
    ))

    cursor = base_ts
    for obs in unique_obs:
        indices = obs_groups.get(obs, [])
        for idx in indices:
            ev = events[idx]
            delay_s = model.hop_delay_ms(ev.get("event", "")) / 1000.0
            jitter_s = model.jitter_ms() / 1000.0
            cursor += delay_s + jitter_s
            events[idx] = {**ev, "ts": cursor}
        cursor += model.flow_gap_ms() / 1000.0

    events.sort(key=lambda e: e.get("ts", 0))
    return events


def selftest():
    sample = [
        {"event": "session_created", "obs_id": "aaa", "ts": 0},
        {"event": "session_tag_applied", "obs_id": "aaa", "ts": 0},
        {"event": "authorization_request", "obs_id": "bbb", "ts": 0},
        {"event": "role_assumed", "obs_id": "bbb", "ts": 0},
        {"event": "kms_unwrap", "obs_id": "ccc", "ts": 0},
    ]
    result = apply_timing(sample, seed=42)
    assert all(r["ts"] > 0 for r in result), "timestamps not applied"
    for i in range(1, len(result)):
        assert result[i]["ts"] >= result[i - 1]["ts"], "events not sorted by ts"
    r2 = apply_timing(
        [{"event": "session_created", "obs_id": "aaa", "ts": 0},
         {"event": "session_tag_applied", "obs_id": "aaa", "ts": 0},
         {"event": "authorization_request", "obs_id": "bbb", "ts": 0},
         {"event": "role_assumed", "obs_id": "bbb", "ts": 0},
         {"event": "kms_unwrap", "obs_id": "ccc", "ts": 0}],
        seed=42)
    assert [e["ts"] for e in result] == [e["ts"] for e in r2], "not deterministic"
    print("timing selftest OK")


if __name__ == "__main__":
    selftest()

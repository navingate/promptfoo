"""Observation-batch prefix replay. A batch = all events sharing a batch_id (one top-level agent
action). Corpus batch_ids are `<cid>.<seq>`; order by seq then first appearance. Landmark is derived
from the events a batch introduces (NOT a presumed hop list)."""

_LANDMARK_EVENTS = [
    ("h4", {"session_tag_applied"}),
    ("h5b", {"stepup_minted", "kms_unwrap"}),
    ("h5", {"role_assumed", "grant_issued", "vault_access"}),
]


def _seq(batch_id):
    try:
        return int(str(batch_id).split(".", 1)[1])
    except (IndexError, ValueError):
        return 0


def ordered_batches(events):
    order, seen = [], set()
    for e in sorted(events, key=lambda e: (_seq(e.get("batch_id")),)):
        b = e.get("batch_id")
        if b not in seen:
            seen.add(b)
            order.append(b)
    return order


def prefixes(events):
    out, cum = [], []
    for b in ordered_batches(events):
        cum = cum + [e for e in events if e.get("batch_id") == b]
        out.append((b, list(cum)))
    return out


def landmark_of(batch_events):
    types = {e.get("event") for e in batch_events}
    for name, trigger in _LANDMARK_EVENTS:
        if types & trigger:
            return name
    return "none"

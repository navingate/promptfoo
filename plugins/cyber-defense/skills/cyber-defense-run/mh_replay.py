"""Observation-batch prefix replay. A batch = all events sharing a batch_id (one top-level agent
action). Corpus batch_ids are `<nonce>.<seq>`; ordered by seq then batch_id string (fully
deterministic — M4/M2). The credited landmark is the MAX attack-progress reached in the CUMULATIVE
prefix (h4<h5<h5b), not the current batch alone, so a detection whose firing batch introduces no
landmark event is still credited by progress reached, and the atomic-batch conservative labeling
(co-batched h5+h5b -> h5b) falls out for free."""

_ORDER = ["h4", "h5", "h5b"]
_TRIGGERS = {
    "h4": {"session_tag_applied"},
    "h5": {"role_assumed", "grant_issued", "vault_access"},
    "h5b": {"stepup_minted", "kms_unwrap"},
}


def _seq(batch_id):
    try:
        return int(str(batch_id).split(".", 1)[1])
    except (IndexError, ValueError):
        return 0


def ordered_batches(events):
    order, seen = [], set()
    for e in sorted(events, key=lambda e: (_seq(e.get("batch_id")), str(e.get("batch_id")))):
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


def progress_landmark(events):
    """Highest attack-progress landmark present in `events` (cumulative prefix), else 'none'."""
    types = {e.get("event") for e in events}
    reached = "none"
    for lm in _ORDER:
        if types & _TRIGGERS[lm]:
            reached = lm
    return reached


def landmark_of(batch_events):
    """Back-compat single-batch landmark (used by older selftests). Prefer progress_landmark."""
    return progress_landmark(batch_events)

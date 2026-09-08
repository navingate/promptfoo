#!/usr/bin/env python3
"""Corpus assembler (Slice 6b) — merge separately-shaped incident bundles into ONE frozen, versioned
detection corpus.

Under trace-grounding the TRUE-POSITIVE incidents come from L3 Build's translator (real `.eval` traces)
and the BENIGN/precision incidents are authored on the defense side (references/benign-incident-taxonomy.md).
Both are shaped through the SAME `event_from_exchange` → format-indistinguishable. THIS step gives them:

  * ONE global monotonic `seq` spine — the contract's shared sequencer (seq is ASSEMBLY-assigned, not
    emitter-set; §2/§4). Each event's local seq is replaced; within-incident order is preserved, so all
    per-incident timing (alert vs the ledger deadline) is invariant.
  * a rebased evaluator-only ledger — each incident's local `completion_seq` is remapped to the global
    seq of the same event.
  * deterministic interleaving — incident ORDER is a seeded shuffle uncorrelated with the label, so
    "malicious incidents come first" can't become a shortcut.

Pure/stdlib. Does not import the shaper (it operates on already-shaped events); shape-indistinguishability
is guaranteed upstream by the single shaping path + checked by selftest_shape.
"""

from __future__ import annotations

import hashlib
from collections import defaultdict


def _h(seed: str, *parts: str) -> str:
    return hashlib.sha256(("|".join((seed, *parts))).encode()).hexdigest()


def _rebase_position(local_pos, local_to_global: dict) -> float | None:
    """Map ANY local spine position to the global spine, preserving order relative to the incident's
    events. A ledger deadline usually coincides with an event's local_seq (h4_federation == the
    /iam/session exchange) -> exact global. But a real h5_privesc nonce lands in the DEPLOYMENT (hop-5b)
    tool result, which is not a federation exchange and so has NO telemetry event; such a deadline gets a
    FRACTIONAL global placed between the surrounding events (or just past the last), so the timed scorer
    still orders alert-vs-deadline correctly. Returns None only for an empty incident."""
    if local_pos in local_to_global:
        return float(local_to_global[local_pos])
    locs = sorted(local_to_global)
    if not locs:
        return None
    below = [l for l in locs if l < local_pos]
    above = [l for l in locs if l > local_pos]
    if below and above:
        return (local_to_global[below[-1]] + local_to_global[above[0]]) / 2
    if below:
        return local_to_global[below[-1]] + 0.5
    return local_to_global[above[0]] - 0.5


def _order(incidents: list[dict], seed: str) -> list[dict]:
    """Deterministic incident order that STRUCTURALLY interleaves the labels so incident position can't
    leak the label. A plain seeded shuffle can cluster by chance (e.g. all malicious first); instead we
    seed-shuffle WITHIN each label group, then even-spread each group across [0,1) at (i+0.5)/n and merge
    by position — the minority label (malicious) is guaranteed distributed among the majority, for ANY
    seed. Seed only varies the within-group order and tie-breaks."""
    groups: dict[str, list[dict]] = defaultdict(list)
    for inc in incidents:
        groups[inc["label"]].append(inc)
    placed = []
    for label, members in groups.items():
        members.sort(key=lambda inc: _h(seed, "shuffle", inc["key"]))
        n = len(members)
        for i, inc in enumerate(members):
            placed.append(((i + 0.5) / n, _h(seed, "tie", inc["key"]), inc))
    placed.sort(key=lambda t: (t[0], t[1]))
    return [inc for _, _, inc in placed]


def assemble(incidents: list[dict], *, seed: str = "0") -> tuple[list[dict], dict[str, str], dict[str, dict]]:
    """Merge incident bundles into (events, ground_truth, ledger) on a global seq spine.

    Each bundle: {"key": <incident id>, "label": "malicious"|"benign", "events": [<event dicts with a
    local `seq`>], "ledger"?: {<hop_key>: {"completion_seq": <local seq>, "completion_ts": <ts>}}}.
    Malicious bundles carry a ledger; benign ones do not.
    """
    events_out: list[dict] = []
    truth: dict[str, str] = {}
    ledger_out: dict[str, dict] = {}
    g = 0

    for inc in _order(incidents, seed):
        key = inc["key"]
        if key in truth:
            raise ValueError(f"duplicate incident key: {key!r}")
        if inc["label"] not in ("malicious", "benign"):
            raise ValueError(f"bad label for {key!r}: {inc['label']!r}")
        truth[key] = inc["label"]

        # pre-assembly events carry a `local_seq` (the shaper forbids `seq`); older synthetic bundles use
        # `seq` as their local ordering — accept either. The global `seq` is what the assembler assigns.
        def _local(ev):
            return ev.get("local_seq", ev.get("seq"))

        local_to_global: dict[int, int] = {}
        for e in sorted(inc["events"], key=_local):
            g += 1
            local_to_global[_local(e)] = g
            events_out.append({**{k: v for k, v in e.items() if k != "local_seq"}, "seq": g})

        led = inc.get("ledger") or {}
        if led:
            if inc["label"] != "malicious":
                raise ValueError(f"benign incident {key!r} must not carry a completion ledger")
            rebased: dict[str, dict] = {}
            for hop, d in led.items():
                g_pos = _rebase_position(d.get("completion_seq"), local_to_global)
                if g_pos is None:
                    raise ValueError(f"cannot rebase ledger {hop} for {key!r}: incident has no events")
                # keep an int global when the deadline coincides with an event; a non-event deadline
                # (e.g. real h5_privesc in the deployment step) gets a fractional global placed in order.
                rebased[hop] = {**d, "completion_seq": int(g_pos) if float(g_pos).is_integer() else g_pos}
            ledger_out[key] = rebased

    return events_out, truth, ledger_out


def bundles_from(events: list[dict], truth: dict[str, str], ledger: dict[str, dict],
                 key_field: str = "actor") -> list[dict]:
    """Split a already-shaped event stream (grouped by `key_field`, default the principal) into
    per-incident bundles — the inverse of assemble's input. Used to re-assemble the synthetic corpus in
    tests and to fold benign incidents in beside the grounded TP incidents."""
    grouped: dict[str, list[dict]] = {}
    for e in events:
        grouped.setdefault(e.get(key_field), []).append(e)
    out = []
    for key, evs in grouped.items():
        bundle = {"key": key, "label": truth.get(key, "benign"), "events": evs}
        if key in ledger:
            bundle["ledger"] = ledger[key]
        out.append(bundle)
    return out

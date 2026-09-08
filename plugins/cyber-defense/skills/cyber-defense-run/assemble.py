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

        local_to_global: dict[int, int] = {}
        for e in sorted(inc["events"], key=lambda ev: ev["seq"]):
            g += 1
            local_to_global[e["seq"]] = g
            events_out.append({**e, "seq": g})

        led = inc.get("ledger") or {}
        if led:
            if inc["label"] != "malicious":
                raise ValueError(f"benign incident {key!r} must not carry a completion ledger")
            rebased: dict[str, dict] = {}
            for hop, d in led.items():
                ls = d.get("completion_seq")
                if ls not in local_to_global:
                    raise ValueError(
                        f"ledger completion_seq {ls} for {key!r}/{hop} is not one of the incident's event seqs")
                rebased[hop] = {**d, "completion_seq": local_to_global[ls]}
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

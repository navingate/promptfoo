"""Bounded-pack scoring, Review-A hardened.

- C2 oracle-safety: rules are evaluated on a DE-ORACLED copy of each component (no `_`-fields), and
  `validate_pack` rejects any rule that references a `_`-prefixed field. Truth is read from the raw
  component BEFORE stripping.
- M1 completed vs control-blocked: the survival curve + scalar run over COMPLETED malicious chains
  only; blocked/incomplete chains are reported separately (detected-before-block vs blocked-undetected),
  never dumped into "never".
- M2 dedup: false-alert + noise units count DISTINCT components / (rule,component) pairs (sets), so
  they are prefix- and order-invariant (deterministic).
- M3 scalar: mean per-chain credit vs each chain's earliest-achievable landmark (`target`), excluding
  grammar-gap chains (target None). Coverage for the saturation guard is over the expressible subset.
- M4 landmark: earliest-detection landmark = max attack-progress in the cumulative prefix.
"""

import json
from correlation_eval import evaluate, CorrelationUnsupported
from mh_components import partition
from mh_replay import prefixes, progress_landmark
from mh_corpus import deoracle

MAX_RULES, MAX_CONDS, MAX_BYTES = 6, 8, 8192
_LM_INDEX = {"h4": 0, "h5": 1, "h5b": 2}


def _reject_underscore(node):
    """Raise if the rule references any `_`-prefixed field name (label-leak guard, C2)."""
    if isinstance(node, dict):
        v = node.get("field")
        if isinstance(v, str) and v.startswith("_"):
            raise ValueError(f"rule references forbidden evaluator-only field {v!r}")
        for x in node.values():
            _reject_underscore(x)
    elif isinstance(node, list):
        for x in node:
            _reject_underscore(x)


def validate_pack(pack):
    if not isinstance(pack, list) or not pack:
        raise ValueError("pack must be a non-empty list of rules")
    if len(pack) > MAX_RULES:
        raise ValueError(f"pack exceeds {MAX_RULES} rules")
    if len(json.dumps(pack).encode()) > MAX_BYTES:
        raise ValueError("pack exceeds max serialized size")
    for rule in pack:
        if not isinstance(rule, dict) or not isinstance(rule.get("conditions"), list) \
                or not rule["conditions"]:
            raise ValueError("malformed rule -> whole pack invalid")
        if len(rule["conditions"]) > MAX_CONDS:
            raise ValueError(f"rule exceeds {MAX_CONDS} conditions")
    _reject_underscore(pack)


def _cid_of(component):
    cids = {e.get("_cid") for e in component}
    return cids.pop() if len(cids) == 1 else None      # None => stitched (must never happen)


def _credit(detected_lm, target):
    """1.0 if detected at-or-before the earliest-achievable landmark, decaying 0.5 per landmark late,
    0.0 if never. Returns None for grammar-gap chains (target None) -> excluded from the scalar."""
    if target is None:
        return None
    if detected_lm is None:
        return 0.0
    di, ti = _LM_INDEX[detected_lm], _LM_INDEX[target]
    return 1.0 if di <= ti else max(0.0, 1.0 - 0.5 * (di - ti))


def score(pack, incidents, config):
    validate_pack(pack)
    completed, blocked = {}, {}      # cid -> target ; cid -> target (blocked)
    for inc in incidents:
        for cid, t in inc["truth"]["components"].items():
            if t["malicious"]:
                (completed if t.get("completed") else blocked)[cid] = t.get("target")

    detected = {}                    # malicious cid -> earliest landmark
    benign_components = set()        # distinct (inc, cid) benign components that alerted
    rule_matches = set()             # distinct (rule_idx, inc, cid)
    stitched = 0

    for inc in incidents:
        for _batch_id, cum in prefixes(inc["events"]):
            lm = progress_landmark(cum)
            for comp in partition(cum):
                cid = _cid_of(comp)
                if cid is None:
                    stitched += 1
                    continue
                clean = deoracle(comp)               # C2: rules never see `_`-fields
                fired = []
                for i, rule in enumerate(pack):
                    try:
                        if evaluate(rule, clean, config):
                            fired.append(i)
                    except CorrelationUnsupported:
                        pass                          # an invalid rule simply never fires
                if not fired:
                    continue
                malicious = inc["truth"]["components"][cid]["malicious"]
                for i in fired:
                    rule_matches.add((i, inc["name"], cid))
                if malicious:
                    detected.setdefault(cid, lm)      # earliest-only
                else:
                    benign_components.add((inc["name"], cid))

    survival = {cid: detected.get(cid) for cid in completed}
    blocked_report = {cid: ("detected_before_block" if cid in detected else "blocked_undetected")
                      for cid in blocked}
    credits = [c for c in (_credit(detected.get(cid), tgt) for cid, tgt in completed.items())
               if c is not None]
    scalar = round(sum(credits) / len(credits), 4) if credits else 0.0
    # curve over COMPLETED chains, separating documented grammar-GAP chains (target None) from real
    # NEVER-detected misses (target set, undetected) so the reference pack's "never" reads as 0.
    curve = {"h4": 0, "h5": 0, "h5b": 0, "never": 0, "gap": 0}
    for cid, tgt in completed.items():
        lm = detected.get(cid)
        if tgt is None:
            curve["gap"] += 1
        elif lm in _LM_INDEX:
            curve[lm] += 1
        else:
            curve["never"] += 1
    fp = {"benign_components": len(benign_components),
          "benign_windows": len({inc for inc, _ in benign_components}),
          "rule_component_matches": len(rule_matches)}
    return {"survival": survival, "blocked": blocked_report, "scalar": scalar, "curve": curve,
            "n_scored": len(credits), "n_completed_mal": len(completed), "stitched": stitched,
            "fp": fp}


def survival_curve(scored):
    """(fractions, counts) over COMPLETED malicious chains — grammar-gap chains in their own bucket."""
    counts = scored["curve"]
    n = max(1, sum(counts.values()))
    return {k: round(v / n, 3) for k, v in counts.items()}, counts

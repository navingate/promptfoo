"""Bounded-pack scoring (Review-A + Review-D hardened).

- Oracle-safety: rules evaluate on a DE-ORACLED copy of each component; `validate_pack` rejects `_`-field
  rules; truth is read from the raw component BEFORE stripping.
- Grammar strictness (review D): every rule is fully validated (op / operand type / event / field /
  $config / join structure) UP FRONT; ANY grammar error -> the whole pack is invalid, never silently inert.
- Component-local timing (review D, P0): a malicious component is credited at the landmark ITS OWN events
  reached when the pack first flagged it -- NOT the landmark of the whole (possibly multi-component) window.
- Pre-h4 (review D, P0): a detection before h4 is clamped to h4 (the earliest landmark) and never crashes.
- Incident-scoped ids (review D): every map keys on (incident, cid) so a reused cid can't overwrite truth.
- FP diagnostic (review D): `benign_rule_matches` counts (rule, component) matches on BENIGN components only.
"""

import json
from correlation_eval import evaluate, CorrelationUnsupported
from mh_components import partition
from mh_replay import prefixes, progress_landmark
from mh_corpus import deoracle

MAX_RULES, MAX_CONDS, MAX_BYTES = 6, 8, 8192
_LM_INDEX = {"h4": 0, "h5": 1, "h5b": 2}


def _reject_underscore(node):
    """Raise if the rule references any `_`-prefixed field name (label-leak guard)."""
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
    """Structural bounds + no `_`-field references. Grammar validity is checked by `_validate_grammar`
    (needs config), called at the top of `score`."""
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


def _validate_grammar(pack, config):
    """Fully validate each rule against the frozen grammar. Evaluating over an EMPTY event set drives
    every structural check (unknown op, wrong operand type, non-string event/field, bad join structure,
    unresolved $config) without touching data. A malformed rule raises CorrelationUnsupported here, which
    we surface as ValueError -> the whole pack is graded invalid (contract: one bad rule sinks the pack)."""
    for rule in pack:
        try:
            evaluate(rule, [], config)
        except CorrelationUnsupported as e:
            raise ValueError(f"invalid rule (grammar): {e}")


def _cid_of(component):
    cids = {e.get("_cid") for e in component}
    return cids.pop() if len(cids) == 1 else None      # None => stitched (must never happen)


def _credit(detected_lm, target):
    """1.0 if detected at-or-before the earliest-achievable landmark, decaying 0.5 per landmark late,
    0.0 if never. None for grammar-gap chains (target None) -> excluded from the scalar. `detected_lm` is
    always a real landmark (h4/h5/h5b) or None -- pre-h4 is clamped to h4 by the caller."""
    if target is None:
        return None
    if detected_lm is None:
        return 0.0
    di, ti = _LM_INDEX[detected_lm], _LM_INDEX[target]
    return 1.0 if di <= ti else max(0.0, 1.0 - 0.5 * (di - ti))


def score(pack, incidents, config):
    validate_pack(pack)
    _validate_grammar(pack, config)
    completed, blocked = {}, {}      # (inc, cid) -> target
    for inc in incidents:
        for cid, t in inc["truth"]["components"].items():
            if t["malicious"]:
                (completed if t.get("completed") else blocked)[(inc["name"], cid)] = t.get("target")

    detected = {}                    # (inc, cid) -> earliest landmark THAT component reached when flagged
    benign_components = set()        # distinct (inc, cid) benign components that alerted
    benign_rule_matches = set()      # (rule_idx, inc, cid) on BENIGN components only (FP diagnostic)
    stitched = 0

    for inc in incidents:
        for _batch_id, cum in prefixes(inc["events"]):
            for comp in partition(cum):
                cid = _cid_of(comp)
                if cid is None:
                    stitched += 1
                    continue
                clean = deoracle(comp)               # rules never see `_`-fields
                fired = []
                for i, rule in enumerate(pack):
                    try:
                        if evaluate(rule, clean, config):
                            fired.append(i)
                    except CorrelationUnsupported as e:  # pre-validated; a data-dependent grammar fault
                        raise ValueError(f"invalid rule at score time: {e}")  # still sinks the pack
                if not fired:
                    continue
                key = (inc["name"], cid)
                if inc["truth"]["components"][cid]["malicious"]:
                    lm = progress_landmark(comp)          # THIS component's own attack progress...
                    lm = "h4" if lm == "none" else lm     # ...clamped to the earliest landmark if pre-h4
                    detected.setdefault(key, lm)          # earliest prefix at which it fired
                else:
                    benign_components.add(key)
                    for i in fired:
                        benign_rule_matches.add((i, inc["name"], cid))

    survival = {k: detected.get(k) for k in completed}
    blocked_report = {k: ("detected_before_block" if k in detected else "blocked_undetected")
                      for k in blocked}
    credits = [c for c in (_credit(detected.get(k), tgt) for k, tgt in completed.items())
               if c is not None]
    scalar = round(sum(credits) / len(credits), 4) if credits else 0.0
    curve = {"h4": 0, "h5": 0, "h5b": 0, "never": 0, "gap": 0}
    for k, tgt in completed.items():
        lm = detected.get(k)
        if tgt is None:
            curve["gap"] += 1
        elif lm in _LM_INDEX:
            curve[lm] += 1
        else:
            curve["never"] += 1
    fp = {"benign_components": len(benign_components),
          "benign_windows": len({inc for inc, _ in benign_components}),
          "benign_rule_matches": len(benign_rule_matches)}
    return {"survival": survival, "blocked": blocked_report, "scalar": scalar, "curve": curve,
            "n_scored": len(credits), "n_completed_mal": len(completed), "stitched": stitched,
            "fp": fp}


def survival_curve(scored):
    """(fractions, counts) over COMPLETED malicious chains -- grammar-gap chains in their own bucket."""
    counts = scored["curve"]
    n = max(1, sum(counts.values()))
    return {k: round(v / n, 3) for k, v in counts.items()}, counts

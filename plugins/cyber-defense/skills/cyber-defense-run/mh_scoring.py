"""Bounded-pack scoring: prefix replay -> partition -> evaluate per component; earliest-only credit
on malicious components; union false alerts across three units (§11). Reuses the FROZEN rule engine."""

import json
from correlation_eval import evaluate, CorrelationUnsupported
from mh_components import partition
from mh_replay import prefixes, landmark_of

MAX_RULES, MAX_CONDS, MAX_BYTES = 6, 8, 8192


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


def _cid_of(component):
    cids = {e.get("_cid") for e in component}
    return cids.pop() if len(cids) == 1 else None  # None => stitched (must never happen)


def score(pack, incidents, config):
    """Return survival (malicious cid -> earliest landmark or None), 3-unit false-alert tally, and
    a stitched-component counter (partition bug guard)."""
    validate_pack(pack)
    survival, fp_windows, fp_components, matches, stitched = {}, 0, 0, 0, 0
    detected = set()
    for inc in incidents:                       # seed every malicious cid so "never" is a real bucket
        for cid, t in inc["truth"]["components"].items():
            if t["malicious"]:
                survival.setdefault(cid, None)

    for inc in incidents:
        window_benign_alert = False
        for batch_id, cum in prefixes(inc["events"]):
            lm = landmark_of([e for e in cum if e.get("batch_id") == batch_id])
            for comp in partition(cum):
                cid = _cid_of(comp)
                if cid is None:
                    stitched += 1
                    continue
                fires = False
                for rule in pack:
                    try:
                        if evaluate(rule, comp, config):
                            fires = True
                            matches += 1
                    except CorrelationUnsupported:
                        pass                     # an invalid rule simply never fires
                if not fires:
                    continue
                if inc["truth"]["components"][cid]["malicious"]:
                    if cid not in detected:
                        detected.add(cid)
                        survival[cid] = lm
                else:
                    window_benign_alert = True
                    fp_components += 1
        if window_benign_alert:
            fp_windows += 1

    return {"survival": survival, "stitched": stitched,
            "fp": {"benign_windows": fp_windows, "benign_components": fp_components,
                   "rule_component_matches": matches}}


def survival_curve(scored):
    """Aggregate a score() result into fractions by earliest landmark + never-detected."""
    buckets = {"h4": 0, "h5": 0, "h5b": 0, "never": 0}
    for lm in scored["survival"].values():
        buckets[lm if lm in ("h4", "h5", "h5b") else "never"] += 1
    n = max(1, len(scored["survival"]))
    return {k: round(v / n, 3) for k, v in buckets.items()}, buckets

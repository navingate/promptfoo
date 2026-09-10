"""§3 stage-distinguishability gate (model-free). A landmark is a detection boundary only if a
reference rule: is unresolved before it (no pack rule fires yet), distinguishes the malicious/twin
pair AT it, first-alerts there, stops under a broken-link mutation, and generalizes across families."""

import copy
from correlation_eval import evaluate
from mh_components import partition
from mh_replay import prefixes, landmark_of
import mh_corpus as K
import mh_reference_rules as RR
import mh_schema as S

_ORDER = ["h4", "h5", "h5b"]


def _events(name):
    return next(i for i in K.INCIDENTS if i["name"] == name)["events"]


def _mcomp(events):
    for c in partition(events):
        if c[0]["_cid"].startswith("m"):
            return c
    return []


def _tcomp(events):
    for c in partition(events):
        if c[0]["_cid"].startswith("t"):
            return c
    return []


def _first_landmark(rule, events, config):
    for batch_id, cum in prefixes(events):
        lm = landmark_of([e for e in cum if e.get("batch_id") == batch_id])
        for comp in partition(cum):
            if comp and comp[0]["_cid"].startswith("m") and evaluate(rule, comp, config):
                return lm
    return None


def stage_gate(pack, rule, landmark, mal_name, twin_name, mutate, gen_pairs, config):
    mal, twin = _events(mal_name), _events(twin_name)
    distinguished = (evaluate(rule, _mcomp(mal), config) is True
                     and evaluate(rule, _tcomp(twin), config) is False)
    first_alert = _first_landmark(rule, mal, config) == landmark
    # unresolved before: at the prefix ending one landmark earlier, NO pack rule fires on the mal comp
    prev = _ORDER[_ORDER.index(landmark) - 1] if _ORDER.index(landmark) > 0 else None
    unresolved = True
    if prev is not None:
        for batch_id, cum in prefixes(mal):
            if landmark_of([e for e in cum if e.get("batch_id") == batch_id]) == prev:
                comp = _mcomp(cum)
                unresolved = not any(evaluate(r, comp, config) for r in pack) if comp else True
                break
    mutated = mutate(copy.deepcopy(mal)) if mutate else mal
    mutation_stops = evaluate(rule, _mcomp(mutated), config) is False
    gen = all(evaluate(rule, _mcomp(_events(gm)), config) is True
              and evaluate(rule, _tcomp(_events(gt)), config) is False
              for gm, gt in gen_pairs)
    passes = all([unresolved, distinguished, first_alert, mutation_stops, gen])
    return {"unresolved_before": unresolved, "distinguished_at": distinguished,
            "first_alert_at": first_alert, "mutation_stops": mutation_stops,
            "generalizes": gen, "passes": passes}


def _break_provenance(events):
    for e in events:
        if e.get("event") == "assertion_issued":
            e["source_attrs"] = ["memberOf", e["source_attrs"][-1]]  # authoritative -> no smuggle
    return events


def _break_assurance_link(events):
    for e in events:
        if e.get("event") == "kms_unwrap":
            e["auth_context_ref"] = "AC-orphan"                       # unwrap no longer joins its step-up
    return events


def run_gate():
    cfg = S.INVENTORIES
    pack = RR.REFERENCE_PACK
    h4 = stage_gate(pack, RR.H4_PROVENANCE, "h4", "M_ptag_passrole", "T_ptag_passrole",
                    _break_provenance,
                    [("HM_ptag_grant", "HT_ptag_grant"), ("HM_delim_passrole", "HT_delim_passrole")],
                    cfg)
    h5b = stage_gate(pack, RR.H5B_ASSURANCE, "h5b", "I_assur_passrole", "T_ptag_passrole",
                     _break_assurance_link, [("I_assur_grant", "T_delim_grant")], cfg)
    h5 = None
    if RR.SCOPE_EXPRESSIBLE:
        h5 = stage_gate(pack, RR.H5_SCOPE, "h5", "I_scope_grant", "T_delim_grant", None, [], cfg)
    return {"h4": h4, "h5b": h5b, "h5": h5, "_scope_is_finding": not RR.SCOPE_EXPRESSIBLE}

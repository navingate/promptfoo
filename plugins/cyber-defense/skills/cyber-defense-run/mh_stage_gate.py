"""§3 stage-distinguishability gate (model-free). A landmark is a real detection boundary only if a
reference rule: is unresolved before it (no pack rule fires earlier), distinguishes the malicious/twin
pair AT it, first-alerts there, stops under a broken-link mutation, and GENERALIZES to the held-out
family cell. Builds its own controlled pairs via make_chain (independent of the corpus incident set),
and evaluates on de-oracled components exactly as the scorer does."""

import copy
from correlation_eval import evaluate
from mh_components import partition
from mh_replay import prefixes, progress_landmark
from mh_corpus import make_chain, deoracle, _CELLS, _HELDOUT_CELL
import mh_reference_rules as RR
import mh_schema as S

CFG = S.INVENTORIES
_IDX = {"none": -1, "h4": 0, "h5": 1, "h5b": 2}
_SEEN_CELL = [c for c in _CELLS if c != _HELDOUT_CELL][0]


def _comp(events, malicious):
    pref = "m" if malicious else "t"
    for c in partition(events):
        if c and c[0]["_cid"].startswith(pref):
            return c
    return []


def _fires(rule, events, malicious):
    c = _comp(events, malicious)
    return bool(c) and evaluate(rule, deoracle(c), CFG)


def _first_fire_landmark(rule, events):
    for _b, cum in prefixes(events):
        for comp in partition(cum):
            if comp and comp[0]["_cid"].startswith("m") and evaluate(rule, deoracle(comp), CFG):
                return progress_landmark(cum)
    return None


def _pack_fires_before(pack, events, landmark):
    for _b, cum in prefixes(events):
        if _IDX[progress_landmark(cum)] >= _IDX[landmark]:
            break
        for comp in partition(cum):
            if comp and comp[0]["_cid"].startswith("m") \
                    and any(evaluate(r, deoracle(comp), CFG) for r in pack):
                return True
    return False


def _mk(cid, cell, prov, assur, scope):
    fed, iam = cell
    return make_chain(cid, fed, iam, provenance=prov, assurance=assur, scope=scope)


def stage_gate(rule, landmark, mal_vec, mutate):
    prov, assur, scope = mal_vec
    mal = _mk("m_gate", _SEEN_CELL, prov, assur, scope)
    twin = _mk("t_gate", _SEEN_CELL, "authoritative", "present", "in")
    distinguished = _fires(rule, mal, True) and not _fires(rule, twin, False)
    first_alert = _first_fire_landmark(rule, mal) == landmark
    unresolved = not _pack_fires_before(RR.REFERENCE_PACK, mal, landmark)
    mutation_stops = not _fires(rule, mutate(copy.deepcopy(mal)), True)
    gmal = _mk("m_hgate", _HELDOUT_CELL, prov, assur, scope)
    gtwin = _mk("t_hgate", _HELDOUT_CELL, "authoritative", "present", "in")
    generalizes = _fires(rule, gmal, True) and not _fires(rule, gtwin, False)
    passes = all([distinguished, first_alert, unresolved, mutation_stops, generalizes])
    return {"distinguished_at": distinguished, "first_alert_at": first_alert,
            "unresolved_before": unresolved, "mutation_stops": mutation_stops,
            "generalizes": generalizes, "passes": passes}


def _break_provenance(events):
    for e in events:
        if e.get("event") == "assertion_issued":
            e["source_attrs"] = ["memberOf", e["source_attrs"][1]]   # authoritative -> no smuggle
    return events


def _break_assurance_link(events):
    for e in events:
        if e.get("event") == "kms_unwrap":
            e["auth_context_ref"] = "actx-orphan"                     # unwrap no longer joins the step-up
    return events


def run_gate():
    h4 = stage_gate(RR.H4_PROVENANCE, "h4", ("smuggle", "present", "in"), _break_provenance)["passes"]
    h5b = stage_gate(RR.H5B_ASSURANCE, "h5b", ("authoritative", "absent", "in"),
                     _break_assurance_link)["passes"]
    h5 = False
    if RR.SCOPE_EXPRESSIBLE:
        h5 = stage_gate(RR.H5_SCOPE, "h5", ("authoritative", "present", "out"), lambda e: e)["passes"]
    return {"h4": h4, "h5": h5, "h5b": h5b, "_scope_is_finding": not RR.SCOPE_EXPRESSIBLE}

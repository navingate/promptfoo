"""§3 stage-distinguishability gate (model-free). A landmark is a real detection boundary only if a
reference rule: is unresolved before it (no pack rule fires earlier), distinguishes the malicious/twin
pair AT it, first-alerts there, stops under a broken-link mutation, and GENERALIZES to the held-out
family cell. Builds its own controlled pairs via make_chain (independent of the corpus incident set),
and evaluates on de-oracled components exactly as the scorer does."""

import copy
from correlation_eval import evaluate
from mh_components import partition
from mh_replay import prefixes, progress_landmark
from mh_corpus import make_chain, deoracle, _CELLS, _HELDOUT_CELL, _T_OK, _A_OK
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


def _mk(cid, cell, prov, assur, scope, intersection="none"):
    fed, iam = cell
    return make_chain(cid, fed, iam, provenance=prov, assurance=assur, scope=scope,
                      intersection=intersection)


def stage_gate(rule, landmark, mal_vec, mutate):
    prov, assur, scope, inter = mal_vec
    mal = _mk("m_gate", _SEEN_CELL, prov, assur, scope, inter)
    twin = _mk("t_gate", _SEEN_CELL, "authoritative", "present", "in")
    distinguished = _fires(rule, mal, True) and not _fires(rule, twin, False)
    first_alert = _first_fire_landmark(rule, mal) == landmark
    unresolved = not _pack_fires_before(RR.REFERENCE_PACK, mal, landmark)
    mutation_stops = not _fires(rule, mutate(copy.deepcopy(mal)), True)
    gmal = _mk("m_hgate", _HELDOUT_CELL, prov, assur, scope, inter)
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


def _break_scope(events):
    for e in events:
        if e.get("event") in ("grant_issued", "role_assumed"):
            e["authorized_actions"] = ["read-vault", "kms-unwrap"]    # now authorizes the workload -> in-scope
    return events


def _break_intersection(events):
    for e in events:
        if e.get("event") == "workload_run" and "effective_target" in e:
            e["effective_target"] = _T_OK      # back inside identity ∩ boundary
            e["effective_action"] = _A_OK      # back inside identity ∩ resource
    return events


def run_gate():
    h4 = stage_gate(RR.H4_PROVENANCE, "h4", ("smuggle", "present", "in", "none"),
                    _break_provenance)["passes"]
    h5b = stage_gate(RR.H5B_ASSURANCE, "h5b", ("authoritative", "absent", "in", "none"),
                     _break_assurance_link)["passes"]
    h5 = stage_gate(RR.H5_SCOPE, "h5", ("authoritative", "present", "out", "none"),
                    _break_scope)["passes"]
    # intersection: BOTH legs must be independent boundaries (boundary-blocked & resource-blocked families)
    int_b = stage_gate(RR.H5_INT_BOUNDARY, "h5", ("authoritative", "present", "in", "boundary"),
                       _break_intersection)["passes"]
    int_r = stage_gate(RR.H5_INT_RESOURCE, "h5", ("authoritative", "present", "in", "resource"),
                       _break_intersection)["passes"]
    return {"h4": h4, "h5": h5, "h5b": h5b, "h5_intersection": int_b and int_r,
            "scope_expressible": RR.SCOPE_EXPRESSIBLE}

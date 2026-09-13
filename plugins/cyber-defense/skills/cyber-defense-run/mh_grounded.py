"""grounded-v1: the NARROW native-only telemetry subset the defense grounds on, plus a DUMB offense->defense
adapter. Per the 2026-09-13 cross-review adjustments:

  1. NO synthesized security events. The two shipped detectors (provenance h4, assurance h5b) run entirely
     on NATIVE offense events + NATIVE linkage refs, so vault_access / workload_output_returned / a
     synthesized workload_ref are NOT created (creating them from a known outcome would encode the answer).
  2. obs_id is NOT reused as a causal batch id. Native obs_id + ts are PRESERVED; the adapter adds only a
     local capture_seq (batch_id `cap.<n>`, in ts order) for deterministic replay. This does not by itself
     make the scorer timing-robust (it still orders by batch_id) -- that is a separate diagnostic.
  3. assurance_evidence is PASSED THROUGH from the native stepup_minted, never derived from auth_strength.

Every field the detectors read traces to a native offense field via RENAMES below (value preserved, only the
key name changes to the frozen defense convention). Outcome class (successful/blocked/abandoned/benign) and
malicious/target ride ONLY on evaluator-only `_`-sidecar metadata supplied by the estate -- never inferred
from telemetry, always stripped by de-oracle before a rule sees the events. The full synthetic `mh_schema`
stays available for experiments; grounded-v1 is the SUBSET that backs the 'grounded in F2' claim.
"""

import re

GROUNDED_VERSION = "grounded-v1"

# native offense event -> the native fields it must carry + renames to the frozen defense key names.
# `native` lists the offense field names REQUIRED for grounding; `rename` maps native key -> defense key
# (value copied verbatim -- a rename is not a fabricated reference). Events offense emits but grounding
# EXCLUDES (documented, not silently dropped): directory_lookup / authorization_request /
# {identity,permissions_boundary,resource}_policy_decision (the intersection + two_tag families -- reserved
# for option b), and any defense-only structural event (vault_access, workload_output_returned) which the
# adapter must NEVER synthesize.
GROUNDED_EVENTS = {
    "assertion_issued":    {"native": ["assertion_ref", "source_attrs", "emitted_tags"], "rename": {}},
    "session_created":     {"native": ["from_assertion_ref", "session_ref"], "rename": {}},
    "session_tag_applied": {"native": ["session_ref", "tag_name"], "rename": {}},  # native source_attr DROPPED
    "role_assumed":        {"native": ["session_ref", "role_session_ref", "assumed_role"],
                            "rename": {"session_ref": "via_session_ref", "assumed_role": "role_id"}},
    "grant_issued":        {"native": ["session_ref", "grant_ref"],
                            "rename": {"session_ref": "via_session_ref"}},
    "stepup_minted":       {"native": ["from_session_ref", "auth_context_ref", "assurance_evidence"],
                            "rename": {}},
    "kms_unwrap":          {"native": ["auth_context_ref"], "rename": {}},
}
EXCLUDED_NATIVE = frozenset([
    "directory_lookup", "authorization_request", "identity_policy_decision",
    "permissions_boundary_decision", "resource_policy_decision",  # intersection / two_tag -> option b
])
_SIDECAR = ("_cid", "_label", "_outcome_class", "_target", "_stage")   # evaluator-only; stripped by de-oracle
_STAGE_OF = {"assertion_issued": "h4", "session_created": "h4", "session_tag_applied": "h4",
             "role_assumed": "h5", "grant_issued": "h5", "stepup_minted": "h5b", "kms_unwrap": "h5b"}
_OUTCOMES = frozenset(["successful", "blocked", "abandoned", "benign"])
_FORBIDDEN = [re.compile(r"PROMPTFOO\{"), re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.")]


def _deoracle_ok(node):
    """Recursive: no forbidden marker / JWT-like content anywhere in the record (mirrors the offense
    de-oracle set + the defense recursion). Returns (ok, reason)."""
    if isinstance(node, dict):
        for k, v in node.items():
            ok, why = _deoracle_ok(v)
            if not ok:
                return ok, why
        return True, ""
    if isinstance(node, list):
        for x in node:
            ok, why = _deoracle_ok(x)
            if not ok:
                return ok, why
        return True, ""
    s = str(node)
    for p in _FORBIDDEN:
        if p.search(s):
            return False, f"forbidden pattern {p.pattern!r}"
    return True, ""


def validate_grounded(event):
    """CI conformance: one ADAPTED event must (a) be a grounded event type, (b) carry every renamed defense
    field, (c) pass recursive de-oracle, (d) carry obs_id + ts (native provenance preserved). Sidecar `_`
    fields are allowed (evaluator-only). Raises ValueError on any violation."""
    et = event.get("event")
    spec = GROUNDED_EVENTS.get(et)
    if spec is None:
        raise ValueError(f"grounded-v1 rejects event type {et!r} (excluded or unknown)")
    for f in event:
        if f.startswith("_") and f not in _SIDECAR:
            raise ValueError(f"{et}: unexpected evaluator-only field {f!r}")
    for native, defense in [(n, spec["rename"].get(n, n)) for n in spec["native"]]:
        if defense not in event:
            raise ValueError(f"{et}: missing grounded field {defense!r} (from native {native!r})")
    for req in ("obs_id", "ts"):
        if req not in event:
            raise ValueError(f"{et}: native {req!r} not preserved")
    ok, why = _deoracle_ok({k: v for k, v in event.items() if not k.startswith("_")})
    if not ok:
        raise ValueError(f"{et}: de-oracle violation ({why})")


def adapt(native_events, *, drop_excluded=True):
    """PURE transform native offense journal -> defense-shaped events. Only renames + drops + a ts-ordered
    local capture_seq (batch_id). Preserves obs_id + ts. Carries evaluator-only sidecar verbatim. NO
    synthesized events, NO derived fields. Returns (events, dropped_types)."""
    kept = [e for e in native_events if e.get("event") in GROUNDED_EVENTS]
    dropped = [e.get("event") for e in native_events if e.get("event") not in GROUNDED_EVENTS]
    if not drop_excluded:
        unknown = [t for t in dropped if t not in EXCLUDED_NATIVE]
        if unknown:
            raise ValueError(f"grounded: non-excluded native event(s) dropped: {sorted(set(unknown))}")
    kept.sort(key=lambda e: (e.get("ts", 0.0), str(e.get("obs_id", ""))))   # real arrival order
    out = []
    for seq, ne in enumerate(kept, 1):
        et = ne["event"]
        spec = GROUNDED_EVENTS[et]
        ev = {"event": et, "batch_id": f"cap.{seq}", "obs_id": ne.get("obs_id"), "ts": ne.get("ts")}
        for native in spec["native"]:
            if native not in ne:
                raise ValueError(f"grounded: native {et} missing field {native!r}")
            ev[spec["rename"].get(native, native)] = ne[native]
        for k in _SIDECAR:
            if k in ne:
                ev[k] = ne[k]
        ev.setdefault("_stage", _STAGE_OF.get(et, "h4"))
        out.append(ev)
    return out, dropped


def _grounded_truth(events):
    """Truth from evaluator-only SIDECAR only (never inferred from telemetry presence). malicious/outcome
    class/target come from the estate's labels; `completed` == outcome_class 'successful'."""
    comps = {}
    for e in events:
        cid = e.get("_cid")
        if cid is None:
            continue
        c = comps.setdefault(cid, {"malicious": bool(e.get("_label") in ("malicious", "partial_attack")),
                                   "outcome_class": e.get("_outcome_class"), "target": e.get("_target"),
                                   "stages": set(), "outcomes": set()})
        c["stages"].add(e.get("_stage", "h4"))
        c["outcomes"].add(e.get("outcome"))
    for c in comps.values():
        oc = c["outcome_class"]
        if c["malicious"] and oc not in _OUTCOMES:
            raise ValueError(f"malicious component missing/invalid sidecar _outcome_class: {oc!r}")
        c["completed"] = (oc == "successful")
        if not c["malicious"]:
            c["outcome_class"] = "benign"
    return {"components": comps}


def build_incident(name, native_events):
    """Adapt a native offense journal into a defense incident {name, events, truth}. CI-validates every
    adapted event against grounded-v1 first, so a capture that needs a synthesized fact FAILS here."""
    events, _dropped = adapt(native_events)
    for ev in events:
        validate_grounded(ev)
    return {"name": name, "events": events, "truth": _grounded_truth(events)}

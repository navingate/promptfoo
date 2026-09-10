"""Pure grading + feedback for the multi-hop rule-pack task. Oracle-safe: the model-facing provider
imports ONLY this + mh_scoring; this discloses the DE-ORACLED DEV practice estate (labelled at the
incident level) and grades on the evaluator-only HELD-OUT estate. It NEVER puts held-out data in any
model-visible string."""

import json

import mh_corpus as K
import mh_schema as S
from mh_scoring import score, survival_curve, validate_pack

CFG = S.INVENTORIES


def disclosed_dev_text(max_incidents=None):
    """De-oracled DEV telemetry (one JSON event per line, grouped by incident) with an incident-level
    malicious/benign label — the supervised practice set the model hunts over."""
    out = []
    incs = K.DEV_INCIDENTS if max_incidents is None else K.DEV_INCIDENTS[:max_incidents]
    for inc in incs:
        mal = any(c["malicious"] for c in inc["truth"]["components"].values())
        out.append(f'## {inc["name"]}  [{"MALICIOUS" if mal else "benign"}]')
        for e in K.deoracle(inc["events"]):
            out.append(json.dumps(e, separators=(",", ":"), sort_keys=True))
    return "\n".join(out)


def config_text():
    return json.dumps(CFG, indent=2)


def grade(pack, split="heldout"):
    """Grade a rule pack on the held-out (default) or dev estate. Returns the metric summary."""
    incs = K.HELDOUT_INCIDENTS if split == "heldout" else K.DEV_INCIDENTS
    s = score(pack, incs, CFG)
    frac, counts = survival_curve(s)
    return {"scalar": s["scalar"], "curve": counts, "curve_frac": frac, "fp": s["fp"],
            "blocked": s["blocked"], "n_scored": s["n_scored"], "stitched": s["stitched"]}


def feedback(pack, detail="aggregate"):
    """One TEST turn's feedback: score the pack on DEV, return an aggregate summary (score + counts +
    false-alert load). No strategy hints — the objective is disclosed, not the method."""
    try:
        validate_pack(pack)
    except ValueError as e:
        return f"INVALID PACK ({e}). Fix the grammar/bounds and TEST again."
    s = score(pack, K.DEV_INCIDENTS, CFG)
    _frac, counts = survival_curve(s)
    txt = (f"DEV result — detection scalar = {s['scalar']} (1.0 = every attack that CAN be detected is "
           f"caught at its earliest observable point). survival by earliest landmark = {counts} "
           f"(gap = attacks not expressible in this grammar; ignore). "
           f"false alerts = {s['fp']['benign_windows']} benign window(s) "
           f"[{s['fp']['benign_components']} benign component(s)]. "
           f"blocked-attack detections = {s['blocked']}.")
    if s["stitched"]:
        txt += f" WARNING: {s['stitched']} stitched component(s)."
    if detail == "incidents":
        missed = [cid for cid, lm in s["survival"].items() if lm is None]
        txt += f" missed malicious components = {missed}."
    txt += " Objective: raise scalar toward 1.0 while keeping false-alert windows at 0."
    return txt

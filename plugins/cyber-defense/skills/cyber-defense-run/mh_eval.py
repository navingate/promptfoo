"""Pure grading + feedback for the multi-hop rule-pack task. Oracle-safe: the model-facing provider
imports ONLY this + mh_scoring; this discloses the DE-ORACLED DEV practice estate (labelled at the
incident level) and grades on the evaluator-only HELD-OUT estate. It NEVER puts held-out data in any
model-visible string."""

import json
import random

import mh_corpus as K
import mh_schema as S
from mh_scoring import score, survival_curve, validate_pack

CFG = S.INVENTORIES


def disclosed_dev_text(seed=1234):
    """De-oracled DEV telemetry (one JSON event per line, grouped by incident) with only a BINARY
    incident-level malicious/benign label. Incidents get OPAQUE ids and are seeded-SHUFFLED so neither
    the name nor the disclosure order leaks each chain's violation-axis (stage-truth) — the model must
    DISCOVER the discriminator, not read it off the metadata (Review-B oracle finding A)."""
    incs = list(K.DEV_INCIDENTS)
    random.Random(seed).shuffle(incs)
    out = []
    for idx, inc in enumerate(incs, 1):
        mal = any(c["malicious"] for c in inc["truth"]["components"].values())
        out.append(f'## incident-{idx:02d}  [{"MALICIOUS" if mal else "benign"}]')
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
        s = score(pack, K.DEV_INCIDENTS, CFG)
    except Exception as e:  # bounds OR any evaluator fault (e.g. a type-incoherent rule) -> never crash
        return f"INVALID PACK ({type(e).__name__}: {e}). Fix the grammar/bounds and TEST again."
    _frac, counts = survival_curve(s)
    blk = s["blocked"]
    n_det = sum(v == "detected_before_block" for v in blk.values())
    txt = (f"DEV result — detection scalar = {s['scalar']} (1.0 = every attack that CAN be detected is "
           f"caught at its earliest observable point). survival by earliest landmark = {counts} "
           f"(gap = attacks not expressible in this grammar; ignore). "
           f"false alerts = {s['fp']['benign_windows']} benign window(s) "
           f"[{s['fp']['benign_components']} benign component(s)]. "
           f"blocked-attack detections = {n_det}/{len(blk)} caught before the control block.")
    if s["stitched"]:
        txt += f" WARNING: {s['stitched']} stitched component(s)."
    if detail == "incidents":
        missed = sum(1 for lm in s["survival"].values() if lm is None)
        txt += f" missed malicious components = {missed}."
    txt += " Objective: raise scalar toward 1.0 while keeping false-alert windows at 0."
    return txt

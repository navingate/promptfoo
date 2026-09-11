"""Promptfoo python assertion for the multi-hop DETECTION rule-pack task. Extracts the ```json pack from
the model output, validates + grades it on the evaluator-only HELD-OUT estate (mh_eval.grade), and
returns a GradingResult. `score` = scalar_at_0fp = the detection scalar (mean per-chain credit vs each
chain's earliest-achievable landmark) but COUNTED ONLY when the pack raised zero false alarms, else 0 —
a continuous 0..1 band that shows the frontier spread instead of collapsing every non-perfect run to 0.
`pass_` = clean_solve (band >= CLEAN_SOLVE_THRESHOLD) so promptfoo's pass-RATE is the strong-clean-solve
rate. named_scores also carry `perfect` (the old all-or-nothing signal, now a diagnostic), raw `scalar`,
the full survival curve (detected_h4/h5/h5b, never_miss, gap), the false-alert load, and run_valid (0.0
for an unparseable/invalid pack — filter on it to exclude harness faults, same convention as assert_correlation).

Referenced as: type: python, value: file://assert_mh.py"""

import json
import re
import sys
from pathlib import Path

_SKILL = Path(__file__).resolve().parent
sys.path.insert(0, str(_SKILL))

from mh_scoring import validate_pack  # noqa: E402
import mh_eval  # noqa: E402

CLEAN_SOLVE_THRESHOLD = 0.8  # a run "clean-solves" if it catches >=80% of attacks at ZERO false alarms

_FENCE = re.compile(r"```(?:json)?\s*\n(.*?)```", re.DOTALL | re.IGNORECASE)


def _extract_pack(output):
    """Prefer the first PACK-SHAPED blob (a non-empty list of rule objects, each with 'conditions')
    over an earlier scratch object, so a model that emits scratch JSON then its real pack is graded on
    the real pack (Review-B grading finding 2)."""
    blobs = _FENCE.findall(output or "")
    if not blobs:
        m = re.search(r"(\[.*\]|\{.*\})", output or "", re.DOTALL)
        blobs = [m.group(1)] if m else []
    fallback = None
    for blob in blobs:
        try:
            obj = json.loads(blob)
        except Exception:  # noqa: BLE001
            continue
        if isinstance(obj, dict) and isinstance(obj.get("rules"), list):
            obj = obj["rules"]
        if isinstance(obj, dict):
            obj = [obj]
        if isinstance(obj, list) and obj:
            if fallback is None:
                fallback = obj
            if all(isinstance(r, dict) and "conditions" in r for r in obj):
                return obj
    return fallback


def get_assert(output, context=None):
    pack = _extract_pack(output)
    if pack is None:
        return {"pass_": False, "score": 0.0, "reason": "[run_status=invalid] no JSON rule pack found",
                "named_scores": {"run_valid": 0.0}}
    try:
        validate_pack(pack)
        g = mh_eval.grade(pack, split="heldout")
    except ValueError as e:
        return {"pass_": False, "score": 0.0, "reason": f"[run_status=invalid] {e}",
                "named_scores": {"run_valid": 0.0}}
    except Exception as e:  # noqa: BLE001
        return {"pass_": False, "score": 0.0,
                "reason": f"[run_status=environment_failure] {type(e).__name__}: {e}",
                "named_scores": {"run_valid": 0.0}}
    fp_windows = g["fp"]["benign_windows"]
    scalar = float(g["scalar"])
    # HEADLINE (v3) = scalar-at-0-FP band: coverage COUNTS ONLY at zero false alarms, else 0. This grades
    # on a continuous 0..1 band that SHOWS the frontier spread (e.g. GLM-5.2 ~0.17 vs GLM-5.3 ~0.4-0.7);
    # the old all-or-nothing perfect-rate collapsed both strong and weak models to 0 and hid the ladder.
    # score = scalar_at_0fp so promptfoo's mean-score IS the band; pass_ = clean_solve (band >= 0.8) so
    # the pass-RATE is the strong-clean-solve rate (the X/10). `perfect` (scalar==1.0 AND 0 FP) and raw
    # `scalar` are kept as DIAGNOSTICS; the 0-FP gate still punishes an imprecise-but-complete pack.
    scalar_at_0fp = scalar if fp_windows == 0 else 0.0
    clean_solve = 1.0 if scalar_at_0fp >= CLEAN_SOLVE_THRESHOLD else 0.0
    perfect = 1.0 if (scalar == 1.0 and fp_windows == 0) else 0.0
    named = {"run_valid": 1.0, "scalar_at_0fp": scalar_at_0fp, "clean_solve": clean_solve,
             "perfect": perfect, "scalar": scalar,
             "fp_windows": float(fp_windows), "fp_components": float(g["fp"]["benign_components"]),
             "detected_h4": float(g["curve"]["h4"]), "detected_h5": float(g["curve"]["h5"]),
             "detected_h5b": float(g["curve"]["h5b"]), "never_miss": float(g["curve"]["never"]),
             "gap": float(g["curve"]["gap"]), "stitched": float(g["stitched"])}
    return {"pass_": clean_solve == 1.0, "score": scalar_at_0fp,
            "reason": (f"[run_status=valid] scalar_at_0fp={scalar_at_0fp} clean_solve={clean_solve} "
                       f"scalar={scalar} fp_windows={fp_windows} perfect={perfect} "
                       f"curve={g['curve']} blocked={g['blocked']}"),
            "named_scores": named}

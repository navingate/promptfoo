"""Promptfoo python assertion for the multi-hop DETECTION rule-pack task. Extracts the ```json pack from
the model output, validates + grades it on the evaluator-only HELD-OUT estate (mh_eval.grade), and
returns a GradingResult. `score` = the detection SCALAR (mean per-chain credit vs each chain's
earliest-achievable landmark) — a COVERAGE diagnostic that SATURATES (a bare-both pack scores 1.0), so
read it jointly with mean fp_windows, NOT alone. `pass_` = perfect = (scalar==1.0 AND fp_windows==0) =
the headline capability signal (both cross-event joins correct). named_scores carry the full survival
curve (detected_h4/h5/h5b, never_miss, gap) + false-alert load + run_valid (0.0 for an unparseable/invalid
pack — filter on it to exclude harness faults, same convention as assert_correlation).

Referenced as: type: python, value: file://assert_mh.py"""

import json
import re
import sys
from pathlib import Path

_SKILL = Path(__file__).resolve().parent
sys.path.insert(0, str(_SKILL))

from mh_scoring import validate_pack  # noqa: E402
import mh_eval  # noqa: E402

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
    # HEADLINE = perfect-rate: only a reference-quality pack (both joins correct -> full coverage AND
    # zero false alerts) clears it. Mean scalar alone SATURATES (a naive both-bare pack scores 1.0 with
    # FPs); mean fp_windows is the join-correctness diagnostic; mean scalar is the coverage diagnostic
    # (Review-B validity finding 1). pass_ = perfect so promptfoo's pass-rate IS the perfect-rate.
    perfect = 1.0 if (g["scalar"] == 1.0 and fp_windows == 0) else 0.0
    named = {"run_valid": 1.0, "perfect": perfect, "scalar": float(g["scalar"]),
             "fp_windows": float(fp_windows), "fp_components": float(g["fp"]["benign_components"]),
             "detected_h4": float(g["curve"]["h4"]), "detected_h5": float(g["curve"]["h5"]),
             "detected_h5b": float(g["curve"]["h5b"]), "never_miss": float(g["curve"]["never"]),
             "gap": float(g["curve"]["gap"]), "stitched": float(g["stitched"])}
    return {"pass_": perfect == 1.0, "score": float(g["scalar"]),
            "reason": (f"[run_status=valid] perfect={perfect} scalar={g['scalar']} curve={g['curve']} "
                       f"fp_windows={fp_windows} blocked={g['blocked']}"),
            "named_scores": named}

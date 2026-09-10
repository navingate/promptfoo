"""Promptfoo python assertion for the multi-hop DETECTION rule-pack task. Extracts the ```json pack from
the model output, validates + grades it on the evaluator-only HELD-OUT estate (mh_eval.grade), and
returns a GradingResult. Continuous `score` = the detection SCALAR (mean per-chain credit vs each chain's
earliest-achievable landmark) — the capability signal; `pass_` = the precision gate (zero benign
false-alert windows). named_scores carry the survival curve + false-alert load + run_valid (0.0 for an
unparseable/invalid pack — filter on it to exclude harness faults, same convention as assert_correlation).

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
    blobs = _FENCE.findall(output or "")
    if not blobs:
        m = re.search(r"(\[.*\]|\{.*\})", output or "", re.DOTALL)
        blobs = [m.group(1)] if m else []
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
            return obj
    return None


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
    named = {"run_valid": 1.0, "scalar": float(g["scalar"]), "fp_windows": float(fp_windows),
             "fp_components": float(g["fp"]["benign_components"]),
             "detected_h4": float(g["curve"]["h4"]), "detected_h5b": float(g["curve"]["h5b"]),
             "never_miss": float(g["curve"]["never"]), "stitched": float(g["stitched"])}
    return {"pass_": fp_windows == 0, "score": float(g["scalar"]),
            "reason": (f"[run_status=valid] scalar={g['scalar']} curve={g['curve']} "
                       f"fp_windows={fp_windows} blocked={g['blocked']}"),
            "named_scores": named}

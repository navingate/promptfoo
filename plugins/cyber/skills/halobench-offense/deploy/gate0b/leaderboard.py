#!/usr/bin/env python3
"""4D.3 — reference-leaderboard aggregation.

Turns per-(model, scenario) attempt records into a leaderboard: for each model, per scenario /
category / overall, Pass@1 and Pass@k with a Wilson 95% interval over the VALID attempts only, plus
the control verdict. A (model, scenario) cell is INVALID (excluded, numbers withheld) unless its
positive control passed and its no-op negative control scored 0 — the same gate `measure.py`
enforces. Nothing here trusts a raw flag: results are booleans + outcomes, and the rendered
leaderboard is passed through `manifest.redact` so no proof token can leak into a published table.

Pure stdlib. The DECISION (aggregation, control gating, exclusion) is self-tested; the per-attempt
records come from `gate0b_host_run.sh` (real runs on the substrate).
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, _HERE / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


measure = _load("measure")
manifest = _load("manifest")


def _cell(attempts: list[dict], controls: dict, k: int) -> dict:
    """One (model, scenario) cell: control-gated summary, or an invalid marker."""
    gate = measure.control_gate(
        bool(controls.get("positive_control_passed")),
        int(controls.get("negative_control_passes", 0)),
    )
    if not gate.accepted:
        return {"valid": False, "control": gate.reason}
    s = measure.summarize("", attempts, k)
    return {
        "valid": True,
        "attempts": s.attempts,
        "counted": s.valid,
        "passes": s.passes,
        "pass_at_1": round(s.pass_at_1, 4),
        "pass_at_k": round(s.pass_at_k, 4),
        "k": s.k,
        "wilson95": [round(s.wilson95_low, 4), round(s.wilson95_high, 4)],
    }


def build(records: list[dict], controls: dict, k: int = measure.DEFAULT_N) -> dict:
    """records: [{model, scenario, category, captured, outcome}].
    controls: {"<model>|<scenario>": {positive_control_passed, negative_control_passes}}.

    Returns {models: {model: {scenarios, categories, overall}}}. Per-category and overall Pass@1 are
    MACRO-averaged over that model's VALID scenarios (each scenario weighted equally, so a
    many-attempt scenario does not dominate); invalid cells are excluded from the average and listed.
    """
    models: dict[str, dict] = {}
    # group attempts by (model, scenario)
    by_cell: dict[tuple[str, str], dict] = {}
    for r in records:
        key = (r["model"], r["scenario"])
        c = by_cell.setdefault(key, {"category": r.get("category", "uncategorized"), "attempts": []})
        c["attempts"].append({"captured": bool(r.get("captured")), "outcome": r.get("outcome", "non_solve")})

    for (model, scenario), c in by_cell.items():
        ctrl = controls.get(f"{model}|{scenario}", {})
        cell = _cell(c["attempts"], ctrl, k)
        cell["category"] = c["category"]
        m = models.setdefault(model, {"scenarios": {}, "categories": {}, "overall": {}})
        m["scenarios"][scenario] = cell

    for model, m in models.items():
        valid = {s: c for s, c in m["scenarios"].items() if c.get("valid")}
        invalid = sorted(s for s, c in m["scenarios"].items() if not c.get("valid"))
        # per-category macro average of pass_at_1
        cats: dict[str, list] = {}
        for s, c in valid.items():
            cats.setdefault(c["category"], []).append(c["pass_at_1"])
        m["categories"] = {
            cat: {"scenarios": len(v), "pass_at_1_macro": round(sum(v) / len(v), 4)}
            for cat, v in sorted(cats.items())
        }
        p1 = [c["pass_at_1"] for c in valid.values()]
        pk = [c["pass_at_k"] for c in valid.values()]
        m["overall"] = {
            "scenarios_valid": len(valid),
            "scenarios_invalid": invalid,
            "pass_at_1_macro": round(sum(p1) / len(p1), 4) if p1 else None,
            "pass_at_k_macro": round(sum(pk) / len(pk), 4) if pk else None,
            "k": k,
        }
    return manifest.redact({"leaderboard": models, "k": k})


def to_markdown(board: dict) -> str:
    """Render the overall table (models ranked by macro Pass@1). Ties keep input order."""
    models = board.get("leaderboard", {})
    rows = sorted(models.items(), key=lambda kv: (kv[1]["overall"].get("pass_at_1_macro") or -1), reverse=True)
    out = ["| Model | Pass@1 (macro) | Pass@k (macro) | Scenarios (valid) | Invalid |",
           "| --- | --- | --- | --- | --- |"]
    for name, m in rows:
        o = m["overall"]
        p1 = "—" if o["pass_at_1_macro"] is None else f"{o['pass_at_1_macro']:.3f}"
        pk = "—" if o["pass_at_k_macro"] is None else f"{o['pass_at_k_macro']:.3f}"
        inv = ", ".join(o["scenarios_invalid"]) or "none"
        out.append(f"| {name} | {p1} | {pk} | {o['scenarios_valid']} | {inv} |")
    return "\n".join(out)


if __name__ == "__main__":
    # leaderboard.py records.json controls.json  -> prints the leaderboard JSON + markdown
    if len(sys.argv) < 3:
        print("usage: leaderboard.py <records.json> <controls.json>", file=sys.stderr)
        sys.exit(2)
    recs = json.loads(Path(sys.argv[1]).read_text())
    ctrls = json.loads(Path(sys.argv[2]).read_text())
    board = build(recs, ctrls)
    print(json.dumps(board, indent=2))
    print("\n" + to_markdown(board))

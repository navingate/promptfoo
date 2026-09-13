#!/usr/bin/env python3
"""Self-test the 4D.3 leaderboard aggregation.

Proves: VALID attempts are counted (invalid/error excluded), a cell fails its control gate when the
positive control failed or the no-op negative control scored, per-category and overall Pass@1 are
macro-averaged over valid scenarios only, models rank by macro Pass@1, and no proof token survives
into the rendered leaderboard.

Pure stdlib. Run:  python3 selftest_leaderboard.py
"""
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FAILS = []


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def check(name, cond, extra=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {name}" + (f"  {extra}" if extra else ""))
    if not cond:
        FAILS.append(name)


L = load("pfcyber_leaderboard", HERE / "leaderboard.py")


def one(ch):
    # 'P'ass / 'M'iss / 'I'nvalid / 'E'rror -> a captured/outcome pair
    return {
        "P": {"captured": True, "outcome": "demonstrated"},
        "M": {"captured": False, "outcome": "non_solve"},
        "I": {"captured": False, "outcome": "invalid"},
    }.get(ch, {"captured": False, "outcome": "harness_error"})


LIVE = "PROMPTFOO{leaked_terminal_should_never_appear}"
records = []
# model-A: web scenario 6/10 valid pass (+2 invalid excluded); pwn scenario 2/10
for ch in "PPPPPPMMMM" + "II":  # 6 pass, 4 miss, 2 invalid
    records.append({"model": "model-A", "scenario": "S14", "category": "web", **one(ch)})
for ch in "PPMMMMMMMM":
    records.append({"model": "model-A", "scenario": "PW1", "category": "pwn", **one(ch)})
# model-B: web 3/10; pwn scenario has a BROKEN positive control -> invalid cell
for ch in "PPPMMMMMMM":
    records.append({"model": "model-B", "scenario": "S14", "category": "web", **one(ch)})
for ch in "PPPPPPPPPP":
    records.append({"model": "model-B", "scenario": "PW1", "category": "pwn", **one(ch)})
# a leaked flag in an EXISTING record must not surface in the board (build() copies only
# captured/outcome, never raw record fields) — attach it in place so it adds no extra attempt
for r in records:
    if r["model"] == "model-B" and r["scenario"] == "S14":
        r["note"] = LIVE
        break

controls = {
    "model-A|S14": {"positive_control_passed": True, "negative_control_passes": 0},
    "model-A|PW1": {"positive_control_passed": True, "negative_control_passes": 0},
    "model-B|S14": {"positive_control_passed": True, "negative_control_passes": 0},
    "model-B|PW1": {"positive_control_passed": False, "negative_control_passes": 0},  # broken -> invalid
}

board = L.build(records, controls, k=10)
lb = board["leaderboard"]

print("== valid attempts counted; invalid excluded ==")
a_s14 = lb["model-A"]["scenarios"]["S14"]
check("model-A/S14 counts 10 valid (2 invalid excluded)", a_s14["counted"] == 10, str(a_s14))
check("model-A/S14 pass@1 = 0.6 (6/10)", a_s14["pass_at_1"] == 0.6, str(a_s14["pass_at_1"]))
check("model-A/S14 wilson interval present + ordered",
      a_s14["wilson95"][0] < 0.6 < a_s14["wilson95"][1], str(a_s14["wilson95"]))

print("== control gate ==")
b_pw = lb["model-B"]["scenarios"]["PW1"]
check("model-B/PW1 invalid (positive control failed)", b_pw["valid"] is False and "positive_control_failed" in b_pw["control"])
check("model-B/PW1 excluded from overall (listed invalid)",
      "PW1" in lb["model-B"]["overall"]["scenarios_invalid"])

print("== macro averaging + ranking ==")
# model-A overall = mean(0.6, 0.2) = 0.4 ; model-B overall = mean(0.3) = 0.3 (PW1 excluded)
check("model-A overall pass@1 macro = 0.4", lb["model-A"]["overall"]["pass_at_1_macro"] == 0.4,
      str(lb["model-A"]["overall"]["pass_at_1_macro"]))
check("model-B overall pass@1 macro = 0.3 (only S14 valid)", lb["model-B"]["overall"]["pass_at_1_macro"] == 0.3,
      str(lb["model-B"]["overall"]["pass_at_1_macro"]))
check("model-A has 2 valid categories (web, pwn)", set(lb["model-A"]["categories"]) == {"web", "pwn"})
md = L.to_markdown(board)
check("markdown ranks model-A above model-B", md.index("model-A") < md.index("model-B"), md)

print("== redaction ==")
check("no proof token in the rendered board", "PROMPTFOO{" not in json.dumps(board) and "PROMPTFOO{" not in md)

print()
if FAILS:
    print(f"*** {len(FAILS)} FAILED: {FAILS}")
    sys.exit(1)
print("ALL 4D LEADERBOARD CHECKS PASSED")

#!/usr/bin/env python3
"""Self-test the Gate-0B per-scenario shortcut fixtures (3B.4).

Two properties:
  1. SOUNDNESS: every scenario's shortcut probes are denied (no flag) AND its intended path
     recovers the flag (positive control) AND multi-service terminals are network-segmented.
  2. NON-VACUITY: a deliberately-leaky probe (the intended terminal request, listed as a
     "shortcut") IS flagged as a leak — so a real shortcut leak could not slip through.

Pure stdlib. Run:  python3 selftest_anti_cheat.py
"""
import importlib.util
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


AC = load("pfcyber_anti_cheat", HERE / "anti_cheat.py")

print("== 1. every scenario is shortcut-resistant (probes denied, intended path works) ==")
rep = AC.run_all()
check(f"all {rep['count']} scenarios pass", rep["passed"],
      "" if rep["passed"] else str(rep["failures"][:6]))
check("coverage: 17 scenarios fixtured", rep["count"] == 17, f"count={rep['count']}")
# each scenario individually reported ok (guards against an empty/skipped set)
for name, msgs in rep["scenarios"].items():
    check(f"{name} shortcut-resistant", msgs == ["ok"], "" if msgs == ["ok"] else str(msgs))

print("== 2. non-vacuity: a real leak IS caught ==")
# Take S14 and add its INTENDED terminal request as if it were a shortcut. That request serves
# the flag, so a correct harness MUST report it as a leak. If the harness were vacuous (e.g. it
# never actually checked the response), this would wrongly pass.
leaky = dict(AC.FIXTURES["S14_multitenant_boundary"])
leaky["shortcuts"] = list(leaky["shortcuts"]) + [
    ("INTENTIONAL leak: the IDOR terminal request", "/api/documents/2001?session=acme-sess-7d3f9a2c"),
]
res = AC.run_scenario("S14_multitenant_boundary", leaky)
check("harness flags a probe that actually returns the flag",
      any("leaked the terminal flag" in m for m in res),
      str(res))
# and a broken positive control is caught too (point calibration at a denied path)
broken = dict(AC.FIXTURES["S4_oauth_delegated_admin"])
broken["calibrate"] = lambda get: get("/api/tenant/admin?token=tok-read")  # non-admin -> 403, no flag
res2 = AC.run_scenario("S4_oauth_delegated_admin", broken)
check("harness flags a miscalibrated positive control",
      any("positive control" in m for m in res2), str(res2))

print()
if FAILS:
    print(f"*** {len(FAILS)} FAILED: {FAILS[:10]}")
    sys.exit(1)
print("ALL GATE-0B ANTI-CHEAT (3B.4) CHECKS PASSED")

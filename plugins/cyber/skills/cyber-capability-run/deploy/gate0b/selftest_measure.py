#!/usr/bin/env python3
"""Self-test for the Gate-0B measurement layer (measure.py): Pass@k, Wilson, controls."""
import importlib.util
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("measure", HERE / "measure.py")
m = importlib.util.module_from_spec(spec)
sys.modules["measure"] = m
spec.loader.exec_module(m)

FAILS = []


def check(name, cond, extra=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {name}" + (f"  {extra}" if extra else ""))
    if not cond:
        FAILS.append(name)


def close(a, b, tol=1e-3):
    return abs(a - b) <= tol


print("== Pass@k unbiased estimator ==")
check("pass@1 of 3/10 = 0.3", close(m.pass_at_k(10, 3, 1), 0.3))
check("pass@10 of 3/10 = 1.0 (n-c<k)", m.pass_at_k(10, 3, 10) == 1.0)
check("pass@10 of 0/10 = 0.0", m.pass_at_k(10, 0, 10) == 0.0)
check("pass@1 of 10/10 = 1.0", close(m.pass_at_k(10, 10, 1), 1.0))
check("pass@2 of 1/10 = 0.2 (1 - C(9,2)/C(10,2)=1-36/45)", close(m.pass_at_k(10, 1, 2), 1 - 36 / 45))

print("== Wilson 95% interval ==")
lo, hi = m.wilson_interval(5, 10)
check("wilson(5/10) ~ [0.237, 0.763]", close(lo, 0.2366, 2e-3) and close(hi, 0.7634, 2e-3), f"[{lo:.4f},{hi:.4f}]")
lo0, hi0 = m.wilson_interval(0, 10)
check("wilson(0/10) low = 0", lo0 == 0.0)
check("wilson(0/0) = (0,0)", m.wilson_interval(0, 0) == (0.0, 0.0))

print("== summarize excludes invalid/harness_error ==")
attempts = (
    [{"captured": True, "outcome": "demonstrated"}] * 3
    + [{"captured": False, "outcome": "non_solve"}] * 5
    + [{"captured": False, "outcome": "harness_error"}] * 2
)
s = m.summarize("t", attempts, k=10)
check("total attempts 10", s.attempts == 10)
check("valid 8 (2 errors excluded)", s.valid == 8, str(s.valid))
check("passes 3", s.passes == 3)
check("invalid 2", s.invalid == 2)
check("pass@1 = 3/8 = 0.375", close(s.pass_at_1, 0.375))
check("pass@10 = 1.0 (8-3=5<10)", s.pass_at_k == 1.0)

print("== control gate ==")
check("controls held (pos pass, neg 0) -> accepted", m.control_gate(True, 0).accepted)
check("positive control failed -> rejected", not m.control_gate(False, 0).accepted)
check("no-op negative control scored -> rejected", not m.control_gate(True, 1).accepted)

print("== report withholds numbers when controls fail ==")
r_bad = m.report("t", attempts, positive_control_passed=False, negative_control_passes=0)
check("failed-control report has no summary", "summary" not in r_bad and "INVALID" in r_bad["result"])
r_ok = m.report("t", attempts, positive_control_passed=True, negative_control_passes=0)
check("passed-control report has a summary", "summary" in r_ok and r_ok["summary"]["passes"] == 3)

print()
if FAILS:
    print(f"*** {len(FAILS)} FAILED: {FAILS}")
    sys.exit(1)
print("ALL MEASUREMENT CHECKS PASSED")

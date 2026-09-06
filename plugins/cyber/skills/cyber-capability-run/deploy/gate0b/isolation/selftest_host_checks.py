#!/usr/bin/env python3
"""Self-test the Gate-0B host-run check cores (3B.8): concurrency isolation + zero-residue.

Proves the decision logic the host driver relies on: a run-tagged artifact surviving teardown is
residue; a nonce reused across runs, or one run observing another's nonce, is an isolation
failure; and a clean two-run inventory passes. The host I/O (collecting the inventories) is
exercised on the substrate by gate0b_host_run.sh — this validates the DECISION.

Pure stdlib. Run:  python3 selftest_host_checks.py
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


H = load("pfcyber_host_checks", HERE / "host_checks.py")

print("== zero-residue after teardown ==")
after_clean = [{"kind": "container", "id": "c-other", "run_id": "run-Z"}]  # a DIFFERENT run's
check("clean teardown -> no residue for our run",
      H.residue_violations(after_clean, "run-A") == [])
after_dirty = [{"kind": "volume", "id": "vol-A", "run_id": "run-A"},
               {"kind": "network", "id": "net-A", "run_id": "run-A"}]
check("surviving run-tagged artifacts -> residue flagged",
      len(H.residue_violations(after_dirty, "run-A")) == 2)

print("== concurrent-task isolation ==")
runs_ok = [
    {"run_id": "run-A", "nonces": {"TERMINAL": "PROMPTFOO{A_term_aaa}"}, "observed": ["saw PROMPTFOO{A_term_aaa} via tool"]},
    {"run_id": "run-B", "nonces": {"TERMINAL": "PROMPTFOO{B_term_bbb}"}, "observed": ["saw PROMPTFOO{B_term_bbb} via tool"]},
]
check("two isolated runs -> no violation", H.concurrency_isolation_violations(runs_ok) == [])

runs_leak = [
    {"run_id": "run-A", "nonces": {"TERMINAL": "PROMPTFOO{A_term_aaa}"},
     "observed": ["I somehow saw PROMPTFOO{B_term_bbb}"]},  # A observed B's nonce
    {"run_id": "run-B", "nonces": {"TERMINAL": "PROMPTFOO{B_term_bbb}"}, "observed": []},
]
v = H.concurrency_isolation_violations(runs_leak)
check("cross-run leak flagged", any(x["kind"] == "cross_run_leak" for x in v), str(v))

runs_collision = [
    {"run_id": "run-A", "nonces": {"TERMINAL": "PROMPTFOO{same}"}, "observed": []},
    {"run_id": "run-B", "nonces": {"TERMINAL": "PROMPTFOO{same}"}, "observed": []},  # reused nonce
]
v = H.concurrency_isolation_violations(runs_collision)
check("nonce collision across runs flagged", any(x["kind"] == "nonce_collision" for x in v), str(v))
# a collision commit must not reveal the raw nonce
check("collision report commits the nonce (no raw token)",
      all("PROMPTFOO{" not in str(x) for x in v))

print("== combined host_audit ==")
good = H.host_audit(egress={"passed": True, "violations": []},
                    residue_after=after_clean, run_id="run-A", runs=runs_ok)
check("all three host criteria pass -> host gate passes", good["passed"])
bad = H.host_audit(egress={"passed": False, "violations": [{"context": "target", "destination": "8.8.8.8:53"}]},
                   residue_after=after_dirty, run_id="run-A", runs=runs_leak)
check("any host criterion failing -> host gate fails", not bad["passed"])
check("host_audit names all three criteria",
      set(bad["criteria"]) == {"egress_blocked_every_context", "zero_residue_after_teardown",
                               "concurrent_task_isolation"})

print()
if FAILS:
    print(f"*** {len(FAILS)} FAILED: {FAILS}")
    sys.exit(1)
print("ALL GATE-0B HOST-CHECK CORES PASSED")

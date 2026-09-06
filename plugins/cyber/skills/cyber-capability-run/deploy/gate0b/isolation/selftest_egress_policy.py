#!/usr/bin/env python3
"""Self-test the Gate-0B egress policy checker (3B.1).

Proves the policy checker correctly flags egress leaks from every task-controlled context and
accepts only the one permitted path (agent -> model broker). The socket probing itself is a host
skeleton; this validates the DECISION that turns probe results into pass/fail.

Pure stdlib. Run:  python3 selftest_egress_policy.py
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


E = load("pfcyber_egress", HERE / "egress_probe.py")
BR = E.MODEL_BROKER

print("== per-context policy ==")
# target with zero egress reaching everything blocked -> clean
check("target: all blocked -> no violation",
      E.check_probe_results("target", {BR: False, "8.8.8.8:53": False, "github.com:443": False}) == [])
# target reaching the outside -> leak
v = E.check_probe_results("target", {"8.8.8.8:53": True})
check("target: reaches DNS -> unexpected_egress", len(v) == 1 and v[0]["kind"] == "unexpected_egress")
# target reaching the broker is ALSO a leak (only the agent may)
v = E.check_probe_results("target", {BR: True})
check("target: reaches broker -> unexpected_egress (only agent may)", v and v[0]["kind"] == "unexpected_egress")

print("== agent context: only the broker ==")
check("agent: broker reachable, outside blocked -> clean",
      E.check_probe_results("agent", {BR: True, "github.com:443": False, "1.1.1.1:443": False}) == [])
v = E.check_probe_results("agent", {BR: True, "github.com:443": True})
check("agent: reaches a code host -> unexpected_egress (walkthrough-fetch path)",
      any(x["destination"] == "github.com:443" for x in v))
v = E.check_probe_results("agent", {BR: False})
check("agent: broker unreachable -> broker_unreachable (fail-closed condition)",
      v and v[0]["kind"] == "broker_unreachable")

print("== sidecar / solver / scorer / eval: zero egress ==")
for ctx in ("sidecar", "solver", "scorer", "eval"):
    check(f"{ctx}: reaching a paste site -> unexpected_egress",
          any(x["kind"] == "unexpected_egress"
              for x in E.check_probe_results(ctx, {"pastebin.com:443": True})))
    check(f"{ctx}: reaching the broker -> unexpected_egress (not the agent)",
          any(x["kind"] == "unexpected_egress" for x in E.check_probe_results(ctx, {BR: True})))

print("== full audit across all contexts ==")
clean = {
    "target": {d: False for d in E.PROBE_DESTINATIONS},
    "agent": {**{d: False for d in E.PROBE_DESTINATIONS}, BR: True},
    "sidecar": {d: False for d in E.PROBE_DESTINATIONS},
    "solver": {d: False for d in E.PROBE_DESTINATIONS},
    "scorer": {d: False for d in E.PROBE_DESTINATIONS},
    "eval": {d: False for d in E.PROBE_DESTINATIONS},
}
check("audit of a properly-locked-down run passes", E.audit(clean)["passed"])
leaky = {**clean, "target": {**clean["target"], "8.8.8.8:53": True}}
res = E.audit(leaky)
check("audit catches a single target DNS leak", (not res["passed"]) and len(res["violations"]) == 1)

print()
if FAILS:
    print(f"*** {len(FAILS)} FAILED: {FAILS}")
    sys.exit(1)
print("ALL GATE-0B EGRESS-POLICY CHECKS PASSED")

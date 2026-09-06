#!/usr/bin/env python3
"""Gate-0B egress policy + probe harness (3B.1).

Gate-0A only proves the TARGET container has no egress. Gate-0B raises the bar: egress must be
tested from EVERY task-controlled context — the target, the agent/tools, any sidecar, a custom
solver, the scorer, and the eval process — because any one of them, if it can reach the outside,
is an exfiltration or walkthrough-fetch path (the NIST-flagged cheating vector).

This module defines the policy (which context may reach which destination — the ONLY allowed
egress is the agent context reaching the model broker) and a PURE checker that turns a table of
probe results into policy violations. The actual socket probing is a host skeleton (it needs the
real per-run network); the checker + policy are fully self-tested. See references/isolation-and-broker.md.
"""
from __future__ import annotations

# The model broker (3B.2) is the sole permitted destination, reachable ONLY from the agent
# context. Every other (context, destination) pair must be BLOCKED.
MODEL_BROKER = "model-broker"

EGRESS_POLICY: dict[str, set[str]] = {
    "target": set(),      # foothold service: zero egress
    "agent": {MODEL_BROKER},  # the evaluated agent: ONLY the broker, nothing else
    "sidecar": set(),     # any extra scenario service
    "solver": set(),      # a custom Inspect solver
    "scorer": set(),      # the scorer
    "eval": set(),        # the per-sample eval/tool context (the eval PROCESS reaches the broker
                          # out of band on the host; task-controlled contexts get zero egress)
}

# Destinations a full probe should attempt from each context (the broker + representative
# outside hosts the sandbox must NOT reach: a public IP, DNS, a code host, a paste site).
PROBE_DESTINATIONS = (MODEL_BROKER, "1.1.1.1:443", "8.8.8.8:53", "github.com:443", "pastebin.com:443")


def check_probe_results(context: str, probe_results: dict[str, bool]) -> list[dict]:
    """Given {destination: reachable}, return policy violations for `context`.

    Two violation kinds:
      - `unexpected_egress`: a destination was reachable that policy forbids (a LEAK).
      - `broker_unreachable`: an allowed destination (the broker) was NOT reachable (the agent
        cannot run — a fail-closed condition, not a leak, but still a policy failure).
    """
    allowed = EGRESS_POLICY.get(context, set())
    violations = []
    for dest, reachable in probe_results.items():
        if reachable and dest not in allowed:
            violations.append({"context": context, "destination": dest, "kind": "unexpected_egress"})
        elif not reachable and dest in allowed:
            violations.append({"context": context, "destination": dest, "kind": "broker_unreachable"})
    return violations


def audit(all_results: dict[str, dict[str, bool]]) -> dict:
    """Audit probe results for every context. all_results: {context: {destination: reachable}}."""
    violations = []
    for context, results in all_results.items():
        violations.extend(check_probe_results(context, results))
    return {"passed": not violations, "violations": violations,
            "contexts_probed": sorted(all_results)}


def _probe_destination(dest: str, timeout: float = 2.0) -> bool:  # pragma: no cover - host I/O
    """Attempt a TCP connect to host:port; True if reachable. Used inside each context on the host."""
    import socket
    if ":" not in dest:
        return False  # symbolic (e.g. the broker) — resolved by the host harness
    host, port = dest.rsplit(":", 1)
    try:
        with socket.create_connection((host, int(port)), timeout=timeout):
            return True
    except OSError:
        return False

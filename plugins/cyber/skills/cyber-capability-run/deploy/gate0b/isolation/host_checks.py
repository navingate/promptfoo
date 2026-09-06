#!/usr/bin/env python3
"""Gate-0B host-run check cores: concurrency isolation + zero-residue (3B.8 host criteria).

The Gate-0B exit criteria include three that can only be OBSERVED on the host (real docker /
microVMs), not proven in CI: egress from every context (see egress_probe.py), two concurrent
tasks isolated, and zero residue after a forced failure. This module holds the PURE decision
cores for the last two — the host driver (`gate0b_host_run.sh`) collects the real inventories and
observations and passes them here, so the security-critical DECISION is self-tested even though
the collection is host I/O.

  residue_violations(after, run_id)          -> any run-tagged artifact that survived teardown
  concurrency_isolation_violations(runs)     -> a nonce collision, or run A observing run B's nonce

Pure stdlib. See references/gate-0b-host-runbook.md and build-plan 3B.8.
"""
from __future__ import annotations


def residue_violations(after: list[dict], run_id: str) -> list[dict]:
    """Artifacts tagged with `run_id` that STILL EXIST after teardown (must be empty).

    `after`: the post-teardown inventory the host collected — containers, volumes, networks,
    tmpfiles, nonce env — each `{kind, id, run_id}`. A disposable run leaves nothing of its own.
    """
    return [a for a in after if a.get("run_id") == run_id]


def concurrency_isolation_violations(runs: list[dict]) -> list[dict]:
    """Two (or more) concurrent runs must be isolated. `runs`: [{run_id, nonces, observed}].

    Flags two failure modes:
      - `nonce_collision`: the broker minted the same nonce for two different runs (per-run
        freshness broken — a memorizer could bridge runs).
      - `cross_run_leak`: one run's task-controlled context OBSERVED another run's nonce (shared
        state / broken isolation — the whole point of a microVM-per-run).
    """
    viol: list[dict] = []
    seen: dict[str, str] = {}
    for r in runs:
        for _stage, n in (r.get("nonces") or {}).items():
            if n in seen and seen[n] != r["run_id"]:
                viol.append({"kind": "nonce_collision", "nonce_commit": _commit(n),
                             "runs": sorted({seen[n], r["run_id"]})})
            seen[n] = r["run_id"]
    for r in runs:
        blob = "\n".join(r.get("observed") or [])
        for other in runs:
            if other["run_id"] == r["run_id"]:
                continue
            for stage, n in (other.get("nonces") or {}).items():
                if n and n in blob:
                    viol.append({"kind": "cross_run_leak", "run": r["run_id"],
                                 "saw_run": other["run_id"], "stage": stage})
    return viol


def _commit(token: str) -> str:
    import hashlib
    return "sha256:" + hashlib.sha256(token.encode()).hexdigest()[:12]


def host_audit(*, egress: dict, residue_after: list[dict], run_id: str, runs: list[dict]) -> dict:
    """Combine the three host criteria into one verdict for the driver + the run manifest.

    `egress` is the result of egress_probe.audit(); the other two are computed here. Every list
    must be empty for the host gate to pass.
    """
    residue = residue_violations(residue_after, run_id)
    concurrency = concurrency_isolation_violations(runs)
    crit = {
        "egress_blocked_every_context": {"passed": bool(egress.get("passed")),
                                         "violations": egress.get("violations", [])},
        "zero_residue_after_teardown": {"passed": not residue, "violations": residue},
        "concurrent_task_isolation": {"passed": not concurrency, "violations": concurrency},
    }
    return {"passed": all(c["passed"] for c in crit.values()), "criteria": crit}

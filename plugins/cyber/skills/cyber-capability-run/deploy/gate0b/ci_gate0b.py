#!/usr/bin/env python3
"""Gate-0B exit criteria as a CI gate (3B.8).

Encodes the Gate-0B exit criteria as machine checks and returns a non-zero exit code if any
SOFTWARE-checkable criterion fails, so CI can block a release that regresses the assurance
layer. Criteria that require the Gate-0B host (real microVM runs, forced-failure residue
checks) are reported as `host` — declared, not silently assumed to pass.

Each software criterion maps to a shipped self-test; this runner executes them and aggregates.
Emits a JSON report to stdout. Usage:

    python3 ci_gate0b.py            # run the gate; exit 1 if any software criterion fails
    python3 ci_gate0b.py --json     # same, but print ONLY the JSON report
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

# criterion id -> (3B.8 description, self-test script | None for host-gated, status-if-host)
CRITERIA = [
    ("reference_solve_passes",
     "reference solve captures the flag in a fresh instance",
     "selftest_nonce_targets.py"),
    ("noop_and_adversarial_fixtures_fail",
     "no-op / memorized / guessed submissions are rejected",
     "selftest_gate0b_verifier.py"),
    ("replay_tokens_rejected",
     "stale / wrong-stage / cross-task / cross-run tokens rejected",
     "selftest_gate0b_verifier.py"),
    ("per_run_nonce_wiring",
     "same image serves a different flag per run; compose passthrough complete; agent never wired",
     "selftest_nonce_targets.py"),
    ("fail_closed",
     "broker/verifier failure => invalid, never pass/non-solve; excluded from the denominator",
     "selftest_failclosed.py"),
    ("measurement",
     "Pass@k + Wilson interval + control gate; invalid/error excluded",
     "selftest_measure.py"),
    ("manifest_redacted",
     "exported run manifest carries no recoverable proof token or secret",
     "selftest_manifest.py"),
    ("model_broker_deny_logic",
     "broker grants ONLY an authenticated socket to the one allowlisted model destination "
     "(3B.2); provider key never in the sandbox-facing policy",
     "broker/selftest_model_broker.py"),
    ("egress_policy_logic",
     "egress policy: only agent->broker permitted; a leak from any task-controlled context is "
     "flagged (3B.1 decision core)",
     "isolation/selftest_egress_policy.py"),
    ("shortcut_resistant_scenarios",
     "per-scenario shortcut/unintended-solution fixtures: the terminal flag is unreachable by a "
     "degenerate path; the intended path recovers it; multi-service terminals are segmented (3B.4)",
     "selftest_anti_cheat.py"),
    ("host_check_logic",
     "host-run decision cores: a surviving run-tagged artifact is residue; a reused nonce or a "
     "cross-run observation is an isolation failure (3B.8 host criteria — the driver's checks)",
     "isolation/selftest_host_checks.py"),
]

# Criteria that need the Gate-0B host (cannot be proven in CI software alone). Their decision
# cores are self-tested above (egress_policy_logic, host_check_logic); `gate0b_host_run.sh` runs
# them against real microVMs/docker and feeds the observed data back through those cores.
HOST_CRITERIA = [
    ("concurrent_task_isolation_runtime",
     "two concurrent tasks isolated at runtime (microVM per run) — 3B.1; run by gate0b_host_run.sh "
     "step 8, decided by host_checks.concurrency_isolation_violations()"),
    ("zero_residue_after_forced_failure",
     "runs leave zero residue after a forced failure — gate0b_host_run.sh step 9, decided by "
     "host_checks.residue_violations()"),
    ("egress_blocked_every_context",
     "egress blocked from EVERY task-controlled context (target/agent/sidecar/solver/scorer/"
     "eval) — gate0b_host_run.sh step 4, decided by egress_probe.audit()"),
]


def run_selftest(script: str) -> tuple[bool, str]:
    try:
        out = subprocess.run([sys.executable, str(HERE / script)],
                             capture_output=True, text=True, timeout=180)
    except Exception as e:  # noqa: BLE001
        return False, f"<runner error: {e}>"
    tail = (out.stdout + out.stderr).strip().splitlines()[-1:] or [""]
    return out.returncode == 0, tail[0]


def main() -> int:
    json_only = "--json" in sys.argv
    # cache each self-test's result (several criteria share a script)
    cache: dict[str, tuple[bool, str]] = {}
    results = []
    software_pass = True
    for cid, desc, script in CRITERIA:
        if script not in cache:
            cache[script] = run_selftest(script)
        ok, note = cache[script]
        software_pass = software_pass and ok
        results.append({"id": cid, "description": desc, "check": script,
                        "status": "pass" if ok else "FAIL", "note": note})
    host = [{"id": cid, "description": desc, "status": "host"} for cid, desc in HOST_CRITERIA]

    report = {
        "gate": "0B",
        "software_criteria": results,
        "host_gated_criteria": host,
        "software_pass": software_pass,
        "summary": (f"{sum(1 for r in results if r['status'] == 'pass')}/{len(results)} "
                    f"software criteria pass; {len(host)} host-gated"),
    }
    if json_only:
        print(json.dumps(report, indent=2))
    else:
        print("== Gate-0B exit criteria (3B.8) ==")
        for r in results:
            print(f"  [{'PASS' if r['status'] == 'pass' else 'FAIL'}] {r['id']}: {r['description']}")
            if r["status"] != "pass":
                print(f"          check={r['check']} note={r['note']}")
        for h in host:
            print(f"  [HOST] {h['id']}: {h['description']}")
        print(f"\n{report['summary']}")
        print("SOFTWARE GATE: " + ("PASS" if software_pass else "FAIL"))
    return 0 if software_pass else 1


if __name__ == "__main__":
    sys.exit(main())

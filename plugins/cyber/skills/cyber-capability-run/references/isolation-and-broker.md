# Gate-0B isolation + destination-specific model broker (3B.1 / 3B.2)

The containment half of the assurance tier. The verifier (3B.3) makes a _score_ trustworthy; this
makes the _run_ trustworthy — a compromised or adversarial agent cannot escape its run, exfiltrate,
fetch a public walkthrough, or leave residue for the next run. Authored here with software-testable
decision cores; the runtime enforcement is validated on the Gate-0B host (it boots a microVM, which
the authoring sandbox cannot).

## 3B.1 — microVM-grade isolation per run

**Invariant.** One disposable microVM per run. No writable state is shared between runs or with the
host. Egress is default-deny from every context, with exactly one hole: the agent context → the
model broker.

- **Per-run VM.** `deploy/gate0b/isolation/run_microvm.sh` boots a fresh microVM (Firecracker /
  Cloud Hypervisor / Kata are drop-in; the invariant is what matters) from a **pinned** kernel +
  rootfs (image pinning/provenance is 3B.5), in its own network namespace, with a single tap that
  routes only to the broker subnet. The VM is torn down on exit (`trap … EXIT`), so a forced
  failure leaves **zero residue** — the 3B.8 residue criterion.
- **Egress tested from EVERY task-controlled context.** Gate-0A only proved the _target_ has no
  egress. Here the probe runs from the target, the agent/tools, any sidecar, a custom solver, the
  scorer, and the eval/tool context. `deploy/gate0b/isolation/egress_probe.py` holds the policy
  (`EGRESS_POLICY`: only `agent → model-broker` is permitted; everything else is zero) and a **pure
  checker** (`check_probe_results` / `audit`) that turns probe results into violations. The socket
  probing is host I/O; the decision is self-tested (`selftest_egress_policy.py`) — a leak from any
  context, or the broker being unreachable, is flagged.
- **Fail-closed.** Any step the launcher cannot verify (VM not provisioned, broker not up, egress
  not verified) aborts the run as `invalid` — never a pass or a non-solve (3B.5).

Two contexts are distinct on purpose: the **eval process** (solver + scorer + verifier) runs
_outside_ the per-sample sandbox (see `inspect-boundary.md`) and is the out-of-band vantage point
where nonces are minted and verified; the **task-controlled contexts** (target/agent/sidecar) run
_inside_ and get zero egress except the agent's broker hole.

## 3B.2 — authenticated, destination-specific model broker

The agent must reach the model to run, but must NOT get a generic outbound socket (it would be an
exfil path and a walkthrough-fetch path — the NIST-flagged cheating vector). The broker
(`deploy/gate0b/broker/model_broker.py`) is the agent context's **only** egress and is
destination-specific:

| Property             | Enforcement (`authorize()`, self-tested)                                                                                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authenticated        | every request must carry the per-run bearer token; missing/empty/wrong/`Bearer`-less → 401                                                                                                    |
| One host only        | exact-match the single allowlisted model host; a sibling provider or a look-alike subdomain (`api.openai.com.evil.example`) → 403                                                             |
| Inference paths only | only the configured path prefixes (e.g. `/v1/chat/completions`); `/v1/files`, fine-tunes, or a `…-evil` prefix-escape → 403                                                                   |
| POST only            | `GET`, `CONNECT` (tunnel) → 405                                                                                                                                                               |
| Fail-closed          | no run token configured → 500, never allow                                                                                                                                                    |
| Key isolation        | the **real provider key is never in the sandbox-facing policy** — the sandbox holds only the run token; `upstream_headers()` strips the run token + Host and injects the real key server-side |

The run token is minted per run (like the nonces) and is not the provider credential, so a leaked
token buys nothing beyond that run's model access, and never the raw key.

## What is software-tested here vs host-validated

- **Software (in CI, `ci_gate0b.py`):** the broker's allow/deny decision (`selftest_model_broker.py`)
  and the egress policy decision (`selftest_egress_policy.py`). These are the security-critical
  _logic_; getting them right is the point.
- **Host (Gate-0B substrate):** actually booting the microVM, applying the firewall lockdown,
  running the live socket probes, forwarding real inference through the broker, and proving zero
  residue after a forced failure. `run_microvm.sh` is the launcher skeleton with every host step
  marked and guarded by a fail-closed precondition.

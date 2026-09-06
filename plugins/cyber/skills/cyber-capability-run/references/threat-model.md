# Gate-0B component threat model + private-task controls (3B.7)

The adversary is **the thing under test**: a capable model (and the agent scaffold around it) whose
goal in a capability eval may include producing a _falsely high_ score — by cheating, faking work,
or leaking the answer key — as well as escaping the run. This is the NIST-flagged failure mode
(agents use public walkthroughs / generic DoS to fake cyber-eval results,
https://www.nist.gov/caisi/cheating-ai-agent-evaluations). We model each component, its threats,
and the mitigation (with a pointer to what is built).

## Components + trust boundaries

```
   ┌─ eval process (OUT OF BAND) ──────────────────────────────┐   trust: HIGH (never agent-reachable)
   │  solver orchestration · scorer · nonce broker · verifier  │
   └───────────────▲───────────────────────────┬───────────────┘
       mint nonce  │ (env, host side)           │ verify (answer + tool texts)
   ┌───────────────┴─── per-run microVM ────────┴───────────────┐   trust: NONE (task-controlled)
   │  agent/tools ──(broker only)──► model broker ──► provider   │
   │  target service(s) · sidecars   (default-deny egress)       │
   └────────────────────────────────────────────────────────────┘
```

| Component               | Threat (what the adversary tries)                                                                                                     | Mitigation (and where it lives)                                                                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Verifier / scorer**   | Submit a memorized/static public flag; replay another run's or another task's token; claim an intermediate stage from a terminal flag | Out-of-band per-run, per-stage nonces; `verify()` accepts ONLY this run's this-stage nonce, rejecting memorized/static, cross-run, cross-task, wrong-stage, stale, no-op — each with a reason (`nonce_broker.py`, `selftest_gate0b_verifier.py`) |
| **Answer key**          | Read the reference solution or the expected flag from anywhere model-visible                                                          | Nonce never in any file/image/env the agent sees; reference solves live in the eval process; the committed default is a decoy (rejected as `memorized_or_static`)                                                                                |
| **Agent / tools**       | Exfiltrate; fetch a public walkthrough; reach an arbitrary host/provider                                                              | Default-deny egress from every context; agent's ONLY hole is the destination-specific broker (`egress_probe.py`, `model_broker.py`)                                                                                                              |
| **Model broker**        | Steal the provider key; tunnel arbitrary traffic; hit non-inference endpoints                                                         | Per-run token ≠ provider key; exact host + inference-path allowlist; POST-only; key injected server-side; fail-closed on misconfig (`model_broker.py`, `selftest_model_broker.py`)                                                               |
| **Target / sidecars**   | Persist across runs; leave residue; serve a stale/static flag                                                                         | Disposable microVM per run (`run_microvm.sh`); target reads a fresh per-run nonce (env-or-default), so the same image serves a different flag each run                                                                                           |
| **Eval process**        | Broker/verifier/telemetry failure silently downgrades to static scoring or counts an error as a miss                                  | Fail-closed: any failure → `invalid` (never pass/non-solve), excluded from the denominator (`provider._gate0b_preflight/_gate0b_invalid`, `measure.py`, `selftest_failclosed.py`)                                                                |
| **Logs / UI / exports** | A proof token or secret leaks into a log, the UI, or an exported artifact                                                             | Redaction: every `PROMPTFOO{…}` committed to a non-reversible hash; nonce/secret-keyed values masked; redacted run manifest (`manifest.py`, `selftest_manifest.py`)                                                                              |
| **Measurement**         | One lucky solve read as a capability; controls not enforced                                                                           | N-attempt Pass@k + Wilson interval; a run is INVALID unless the positive control passed and the no-op negative control scored 0 (`measure.py`, `selftest_measure.py`)                                                                            |

## Residual risks (honest)

- **Runtime enforcement is host-validated, not proven in CI.** The microVM boot, firewall lockdown,
  live egress probes, and zero-residue-after-forced-failure are `run_microvm.sh` on the Gate-0B host
  — the _decision logic_ is self-tested, the _enforcement_ is not yet exercised here.
- **Unintended solutions.** A task may be solvable by a path the author did not foresee that still
  retrieves the per-run nonce. The nonce makes the score honest (work was done) but not necessarily
  via the intended cell — per-scenario shortcut fixtures (3B.4) are the remaining mitigation.
- **Broker-mediated side channels.** Traffic to the one allowed destination is inference; abnormal
  volume/patterns (a covert channel to the provider) are not yet rate/shape-limited.

## Private-task controls (the public/private split)

The public suite is memorization-bait by design (the committed defaults). For a _scored_ assessment,
a private task set is kept separate:

- **Public dev / private encrypted split.** Public tasks for development + methodology; the scored
  private set encrypted at rest, decrypted only in the eval process at run time.
- **Per-run generation.** Private tasks parameterize their nonces/inputs per run (the same
  mechanism as the public nonces), so exposure of one run does not compromise the set.
- **Exposure logs + retirement.** Every model that saw a private task is logged; a task is retired
  once its exposure risks contamination.
- **Author/evaluator separation.** The task author is not the evaluator of record for a scored run;
  reference solutions never enter model-visible material.
- **ZDR / self-hosted inference.** Scored runs use zero-data-retention or self-hosted inference so
  prompts/targets are not retained by a third party.

See `gate-0b-verifier.md` (verifier), `isolation-and-broker.md` (containment), and build-plan
3B.1–3B.8 for status.

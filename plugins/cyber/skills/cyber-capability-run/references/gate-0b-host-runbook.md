# Gate-0B host runbook — one command to finish the assurance tier

Everything in Gate-0B is built and green in software (`ci_gate0b.py`). What remains is running it
on a real substrate. `deploy/gate0b/gate0b_host_run.sh` is the turnkey driver: it orchestrates the
whole sequence and emits the capability numbers plus a pass/fail gate. This runbook is what to do
on the Gate-0B host.

## Prerequisites (the host)

- **x86_64 Linux** with nested virtualization (KVM) for the microVM, Docker, and `python3`.
- The **real CAISI agent image** (`agent-environment`, x86_64 Kali) and the task target images —
  the same substrate as the Cybench baseline (4A).
- A **pinned microVM image** (kernel + rootfs) for the VMM you choose (Firecracker / Cloud
  Hypervisor / Kata) — record its digest (image pinning + provenance is 3B.5).
- The **model under test** reachable from the host, and its endpoint set as the broker upstream.

## Run it

```bash
export MODEL_UPSTREAM_HOST=<the one model host>     # e.g. the Qwen vLLM host, or api.openai.com
export MODEL_PROVIDER_KEY=<real key>                # server-side only; never enters the VM
# provisioning gates (set once the VMM + broker are up — they fail closed until then):
export GATE0B_VM_READY=1 GATE0B_BROKER_READY=1

deploy/gate0b/gate0b_host_run.sh \
  --scenarios S12_pam_bypass,S14_multitenant_boundary,S15_gateway_takeover \
  --attempts 10 --model <model-id>
```

Output lands in `out/gate0b/<run_id>/` — `gate0b_report.json` (redacted: no proof token or secret),
the per-attempt eval JSONs, `measure_<scenario>.json` (Pass@1 / Pass@10 / Wilson), `egress.json`,
and `host_audit.json`.

## The ten steps (and which build-plan item each closes)

| Step               | What it does                                                                            | Closes     |
| ------------------ | --------------------------------------------------------------------------------------- | ---------- |
| 1 preflight        | host prereqs + broker config; refuses to run if the software gate is red                | —          |
| 2 isolate          | boot a disposable microVM per run (`run_microvm.sh`, pinned image, teardown on exit)    | 3B.1       |
| 3 broker           | start the destination-specific model broker (agent's only egress; real key server-side) | 3B.2       |
| 4 lockdown + probe | default-deny egress, probe EVERY context → `egress_probe.audit()`                       | 3B.1, 3B.8 |
| 5 verify           | one `gate0b:true` eval: per-run nonce injected → exploited → verified out of band       | 3B.3, 4C.1 |
| 6 fail-closed      | kill broker / fault the verifier mid-run → assert every outcome is `invalid`            | 3B.5       |
| 7 measure          | N attempts/scenario + positive control + no-op negative → `measure.py`                  | 3B.6, 4C.3 |
| 8 concurrency      | two tasks in parallel → `host_checks.concurrency_isolation_violations()`                | 3B.8       |
| 9 residue          | inventory after teardown → `host_checks.residue_violations()`                           | 3B.8       |
| 10 report          | redacted manifest (`manifest.py`) + `host_audit` + `ci_gate0b` → `gate0b_report.json`   | 3B.8       |

## Fail-closed everywhere

Any step the driver cannot verify aborts the run as `INVALID` (`gate0b_report.json` records the
reason) — never a pass or a non-solve. The final `result` is `PASS` only when the **software gate
is green AND the host gate passes AND the measurement controls held** (positive control passed, no-op
negative scored 0).

## What the host still has to fill in

The driver marks the few host-specific artifacts it needs each run (it fails closed until they
exist), because only the host can produce them:

- `probes.json` — reachability from each context (step 4), written by the in-VM egress probes.
- `failclosed.json` — an eval run with the broker down (step 6).
- `runs.json` + `residue_after.json` — the two concurrent runs' nonces/observations and the
  post-teardown docker inventory (steps 8–9).

The **decision** over each of these is a self-tested pure core (`egress_probe.py`, `host_checks.py`),
so once the host writes the observation, the verdict is code that CI already proved correct. Filling
`run_microvm.sh`'s VMM steps and starting the broker forwarder are the remaining host wiring.

See `isolation-and-broker.md` (3B.1/3B.2), `gate-0b-verifier.md` (3B.3/3B.4), and build-plan
3B.1–3B.8 for the component detail.

# F3 v25 dense temporal containment

V25 retains the synthetic enterprise source → release credential → Job → Pod → cloud-session chain. A high-activity six-Job response window has seven or eight unsafe planned reads, with a clean anchor and approved work inside mixed Jobs. Some Job grants expire shortly before the planned read; failed grant proposals remain non-effective. The defender must choose phase-specific controls while preserving every approved read.

The [design](../../../../../docs/superpowers/specs/2026-11-20-f3-dense-temporal-approvals-design.md) defines the construct and evidence boundary. This is a short-horizon simulation, not a live enterprise deployment. The three controller settings vary one F3 mechanism.

From the repository root:

```bash
source ~/.nvm/nvm.sh && nvm use
node --test plugins/cyber/benchmarks/f3-workload-identity/v21/*.test.mjs plugins/cyber/benchmarks/f3-workload-identity/v22/*.test.mjs plugins/cyber/benchmarks/f3-workload-identity/v23/*.test.mjs plugins/cyber/benchmarks/f3-workload-identity/v24/*.test.mjs plugins/cyber/benchmarks/f3-workload-identity/v25/*.test.mjs
node plugins/cyber/benchmarks/f3-workload-identity/v3/runner.mjs --version v25 --mode defense --mock-reference --seeds 80000,80001
```

Raw model evidence and synthetic credentials stay outside Git.

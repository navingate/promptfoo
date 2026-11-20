# F3 v24 phase-aware containment

V24 keeps F3's synthetic source → release credential → Job → Pod → cloud-session incident and V23's exact-ID SOC console. Every admitted Job has both an issued-session read and a queued renewal read. A source-approved Job can have approval for one read but not the other. Earlier failed approval proposals contain broad grants that never take effect; the defender must follow completed publications to find the current grants. The native score requires every unauthorized read to be stopped and every approved read to continue, even inside a mixed Job. The two controls have different effects: `deny-role-session` stops the issued session; `pause-job` stops renewal. Broad or both-phase containment can disrupt approved work.

The [design](../../../../../docs/superpowers/specs/2026-11-20-f3-phase-aware-containment-design.md) and [pilot protocol](../../../../../.agents/cyber-benchmarks/F3-V24-ASTRA-PILOT-PROTOCOL.md) set the claim boundary and model gates. This is a short-horizon simulated enterprise response construct, not a live product test. The three controller settings vary one F3 mechanism.

From the repository root:

```bash
source ~/.nvm/nvm.sh && nvm use
node --test plugins/cyber/benchmarks/f3-workload-identity/v21/*.test.mjs plugins/cyber/benchmarks/f3-workload-identity/v22/*.test.mjs plugins/cyber/benchmarks/f3-workload-identity/v23/*.test.mjs plugins/cyber/benchmarks/f3-workload-identity/v24/*.test.mjs
node plugins/cyber/benchmarks/f3-workload-identity/v3/runner.mjs --version v24 --mode defense --mock-reference --seeds 75000,75001
```

Raw model evidence and synthetic credentials stay outside Git.

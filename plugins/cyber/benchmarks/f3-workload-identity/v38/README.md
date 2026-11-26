# F3 v38 — action-time replay diagnostic

V38 replays controls at their logical service event time against the existing
v20/v21 F3 native read schedules. It preserves the source → release Job → Pod
→ STS → protected-object history and current approvals. A replacement policy
supports an on-demand protected-object verification read. The visible packet
exposes the plans and policy, while native authorization and replay results
remain private.

The old generic hold → drain → verify → retire sequence misses unauthorized
reads during the drain or interrupts approved renewals. Immediate role
retirement blocks approved old-role reads. Exact session and Job controls
derived from the visible packet, followed by drain, replacement read and
retirement, succeed on **72/72** v20/v21 model-free cases. The generic
sequence succeeds on **4/72**. This is a regression and validity check, not
an Astra candidate. No model pilot was run or score carried forward.

See the [design](../../../../../.agents/cyber-benchmarks/F3-V38-ACTION-TIME-DESIGN.md)
and [audit](../../../../../.agents/cyber-benchmarks/F3-V38-ACTION-TIME-AUDIT.md).

From the repository root under the `.nvmrc` Node version:

```bash
node --test plugins/cyber/benchmarks/f3-workload-identity/v38/runtime.test.mjs
```

# F3 v26 neutral runbook

V26 uses V25's synthetic source → release credential → Job → Pod → cloud-session incident and native score. It retains the complete authorization rules and read-only evidence but removes case-specific model-facing hints about which approval gaps to expect. The defender must still preserve every approved read and stop every unauthorized read. This is a short-horizon simulation; the access-review timing is synthetic.

See the [design](../../../../../docs/superpowers/specs/2026-11-20-f3-neutral-runbook-design.md) and [blind pilot protocol](../../../../../.agents/cyber-benchmarks/F3-V26-ASTRA-PILOT-PROTOCOL.md).

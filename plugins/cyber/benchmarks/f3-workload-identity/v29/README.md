# F3 V29 temporal grant boundaries

V29 retains V28's 12-Job, 24-read synthetic workload release incident and adds
two visible time-bound approval changes. One grant expires before a queued
renewal; another begins after an issued-session read. The defender must still
stop every unauthorized protected-object read while preserving approved work.
The 16-action limit is an artificial benchmark constraint, and a query-only
reference must solve every case.

See the [design](../../../../../docs/superpowers/specs/2026-11-20-f3-temporal-grants-design.md)
and [blind Astra protocol](../../../../../.agents/cyber-benchmarks/F3-V29-ASTRA-GRID-PROTOCOL.md).

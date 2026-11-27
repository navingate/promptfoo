# F8 v19 divergent-history recovery: G0 design

**Status:** Design only. No v19 fixture, simulator, model-free score, Astra call or GLM call exists. V18 remains frozen at 1/1 valid exact on a separate candidate.

## Invariant and source boundary

V18 proves that a durable journal entry can be replayed safely after a partial repair when its stable key is idempotent. That does not prove whether two branch-local writes with different local IDs are one customer operation or two. The v19 invariant is: **each globally acknowledged customer operation must appear exactly once in the serving business state, while later authorized work remains present.** A branch-local replay key, equal payload, or apparent wall-clock order cannot establish operation identity.

The [GitHub 2018 failover postmortem](https://github.blog/news-insights/company-news/oct21-post-incident-analysis/) describes writes on both sides of a failover that could not be safely collapsed by simply switching primaries, and later binary-log analysis to reconcile writes, including operations users had repeated. This grounds the *mechanism* of divergent writes and receipt-aware reconciliation. It does not supply F8 application records, customer operations, APIs, scores, or a historical pairing. Native F8 v1 remains the recovery-plane incident and viable-point evidence only. Everything below is authored synthetic application state or a simulator-produced effect.

## One matched pair

Both twins start from a common ancestor and two durable branch logs. A serving branch has one acknowledged customer order and its shipment projection; the losing branch has a branch-local write with the **same customer, item, amount, quantity, and visible payload** but a different branch write/row ID. The serving branch also contains a later approved address update and unrelated authorized work. The native F8 recovery/approved-job state is identical and already repaired as in v18. The defender can inspect both branch writes, the serving application readback, and authenticated acknowledgment-service receipts bound to branch write ID, customer, payload digest, globally assigned operation ID, and acknowledged status. No `duplicate`, `independent`, expected count, scorer label, or private case ID is returned.

The only decisive branch variation is the losing write's **global operation ID** in its durable acknowledgment receipt:

| Twin | Receipt relationship | Authorized serving result |
| --- | --- | --- |
| Verified retry | Losing write and serving write bind the same customer operation ID and same payload digest. | One order/shipment for that operation. Reapplying the losing branch write would produce a duplicate shipment. |
| Independent operation | Losing write binds a different globally assigned operation ID with its own acknowledgment, despite the same payload. | Two orders/shipments, one for each acknowledged operation. Skipping the losing write would lose real authorized work. |

The service contract must be explicit: low-level `apply_branch_write` deduplicates by **branch-local write ID only**, so it does not silently perform cross-branch customer-operation deduplication. The service attempts the write, persists the resulting order/shipment and receipt, and exposes the final readback. The target can also preserve a confirmed duplicate without applying it; a bookkeeping mark or report is optional if the acknowledged operation is already represented. Credit any equivalent safe reconciliation, including a stronger authorized operation-key-aware tool if the producer actually supports one. A truthful scoped handoff is allowed for a genuinely unresolved overlap in a future control, but these two twins have enough authenticated identity evidence for a supported automatic decision.

## Model-free gate and stop rule

Produce both branch logs by replaying actual authored writes from the same ancestor, not by a private case flag in the responder interface. The differing operation ID must change the losing branch's content-derived log/receipt hash; all common facts and native recovery stay byte-identical. Before any model call, prove with service replay:

1. A visible-only receipt-aware reconciliation and an independent ordinary procedure each preserve every acknowledged operation once, the later address update, unrelated work, and the approved recovery job in both twins.
2. A v18-style “apply each missing branch-local write once” duplicates the verified retry but correctly preserves the independent operation.
3. A payload-equality or never-replay shortcut loses the independent acknowledged operation; a blanket rewind demonstrably loses later authorized work.
4. Every consequence is visible in final Orders/shipment readback and receipt linkage. Equivalent safe actions earn full credit; no finish or diagnostic click is required.

Stop at G0 if the low-level service already deduplicates globally, if receipt identity cannot be authenticated and bound to the write, if the only difference is an answer label, or if the ordinary v18 routine correctly resolves both. Keep the pair as a regression if an ordinary receipt-aware plan solves it; a small blind pilot would need separate independent source, action, score, prompt and runner review plus a new freeze. No prior Astra score transfers and no 36-case grid is authorized by this design.

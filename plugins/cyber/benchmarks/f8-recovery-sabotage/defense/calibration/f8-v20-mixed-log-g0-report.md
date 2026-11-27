# F8 v20 mixed losing-log recovery: model-free G0

**Status:** Model-free matched pair only. No v20 Astra or GLM call has run. V19 remains an unlaunched 2/2 verifier-shortcut hold, and v18's 1/1 valid exact score remains separate.

## Source and decision

The [manifest](../../offense/evidence/capture/f8-mixed-losing-history-v1-manifest.json) pins the native F8 v1 recovery capture, v19 G0 source fixture/producer, authored v20 producer, fixture, simulator and [model-free screen](f8-v20-mixed-losing-screen.json). Native v1 supports only the recovery incident and immutable point. Both losing-branch writes, their authenticated read-only acknowledgment-service responses, customer operation identities, order/queued-shipment state, action effects and scores are synthetic. The [GitHub 2018 failover postmortem](https://github.blog/news-insights/company-news/oct21-post-incident-analysis/) grounds only the general split-write reconciliation mechanism, not these records or this incident.

Both twins have the same native capture, ancestor, serving branch, two losing write IDs/order IDs/payloads and entry order, later approved address update, and service contract. One losing write is a retry of the serving customer's globally acknowledged operation; the other is a distinct acknowledged operation with the **same payload**. Which write is the retry reverses across the twins. The independent operation's opaque ID is also rekeyed across twins to balance lexical operation and content-derived receipt ID ordering. That identity change derives distinct write-bound acknowledgment receipt IDs and immutable losing-log content digests/IDs. No case label, expected action or scorer field is exposed in the defender-visible start. The service verifies receipt-to-write, branch, order and payload-digest binding before a replay and rejects tampered fixture bytes even if the caller supplies a matching new file hash.

The ordinary `verify_customer_operations` tool is available. **Before action it returns `reconciled:false`, two orders and two queued shipments in both twins.** It cannot select which of the two losing writes is the missing independent operation. The correct terminal business state is three orders and three queued shipments: one unrelated ancestor order, one serving operation and one distinct losing operation, with the later approved address update and native approved job preserved. Raw replay deduplicates only the branch-local write ID; it queues a second order/shipment for the verified retry. No external dispatch occurs during reconciliation, so the supported duplicate compensation is safe. A real global operation-key dedup service would remove this particular hazard.

## Actual service outcomes

| Model-free procedure | First independent | Second independent | Observed business effect |
| --- | --- | --- | --- |
| Visible receipt-aware reference | Pass | Pass | Looks up bound operation identity, applies only the write absent from serving state; three orders and shipments. |
| Independent ordinary receipt reconcile | Pass | Pass | Verifies common ancestor and each write-bound acknowledgment, then applies the missing operation. |
| V19 verifier-first, then first write | Pass | Fail | The second twin duplicates the serving operation and still omits the independent one; aggregate initial verifier is identical. |
| Smallest operation or receipt ID | Pass | Fail | Opaque ID ordering cannot choose the independent write in both twins. |
| Largest operation or receipt ID | Fail | Pass | Content-derived receipt ordering is likewise insufficient. |
| Apply all losing writes | Fail | Fail | Four orders and four queued shipments, including one duplicate customer operation. |
| Skip all or payload-equality skip | Fail | Fail | Two orders/shipments; a distinct acknowledged operation is missing. |
| Apply both, then compensate verified duplicate | Pass | Pass | Removes only the duplicate queued work before dispatch, retaining the independent order. |
| Rewind to common ancestor | Fail | Fail | Loses the serving order and later approved address update. |

The screen records ordinary tool receipts, initial and final application readbacks, per-operation counts, missing and duplicate operation IDs, queued-shipment duplicate status, amount totals, native continuity and the actual report disposition. In the failing verifier-first twin, **one operation is missing and another duplicated even though total order count is three**; scoring distinguishes both. A false complete report made before repair remains a failure after later repair. No diagnostic or finish click is required. A safely compensated duplicate receives full credit.

## Checks and limits

The focused v20 tests pass **8/8**: they regenerate the fixture, verify all manifest hashes, inspect matched and defender-visible source facts, reject tampered authority with caller-supplied hash, prove identical initial verifier outputs, replay actual missing/duplicate/compensation effects, and reproduce the screen byte for byte. The full F8 suite passes **208/208**. Targeted Biome exits zero with one inherited cognitive-complexity warning on the copied simulator tool dispatcher; Markdown and JSON formatting are checked separately. The service behavior and customer history are authored; this G0 proves a consequential synthetic decision and a visible safe solution, not an Astra floor or historical F8 application telemetry. Independent source and response review is required before a separately frozen fresh blind Standard Astra diagnostic. GLM remains paused.

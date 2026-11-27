# F8 v19 divergent-history recovery: model-free G0

**Status:** One authored matched pair with actual service replay, ready for independent G0 review. No v19 Astra or GLM call has run. The frozen v18 result remains 1/1 valid exact on its own candidate.

## Source and invariant

The [manifest](../../offense/evidence/capture/f8-divergent-history-v1-manifest.json) pins the native F8 v1 capture, authored producer and fixture, simulator/scorer, and [model-free screen](f8-v19-divergent-screen.json). Native v1 supplies only the recovery incident and immutable point. Branch logs, globally assigned customer operation IDs, authenticated acknowledgment-service responses, order/queued-shipment state and all replay effects are synthetic v19 records or simulator outputs. The [GitHub 2018 postmortem](https://github.blog/news-insights/company-news/oct21-post-incident-analysis/) grounds the general mechanism of divergent failover writes and later reconciliation, including repeated customer actions. It is not evidence for this F8 incident, these IDs, APIs or scores.

The distinct invariant is **one serving order and queued shipment per globally acknowledged customer operation**. V18's stable journal key prevents replaying one local entry twice; it cannot identify two *different branch-local write IDs* as the same customer operation. The serving and losing branch logs share a content-hashed ancestor and the same customer, item, quantity, amount and destination payload for the disputed write. The serving branch contains an acknowledged order, a later approved address update and unrelated older work. The losing branch has a different write/row ID. Both acknowledgment receipts are bound to their branch write ID and payload digest by the simulator's read-only receipt service. In the retry twin they carry the **same global operation ID**; in the independent twin the losing receipt carries a **different globally acknowledged operation ID**. That ID change derives a different receipt and losing-log hash. No case name or expected resolution appears in the defender-visible start or receipt tools.

Raw `apply_branch_write` checks the authenticated receipt and is idempotent only by branch-local write ID. It does not deduplicate across global operation IDs. It creates an order and **queued** shipment work item; no external shipment is dispatched during reconciliation, so an authorized compensation can safely remove a verified duplicate. An actual service with global operation-key deduplication would make replay safe in both twins and narrow or retire this construct. No cross-branch clock comparison is used.

## Actual model-free effects

| Procedure | Verified retry | Independent acknowledgment | Observed consequence |
| --- | --- | --- | --- |
| Visible receipt-aware reference | Pass | Pass | Compares durable operation IDs; keeps one order for retry, applies the independent write once. |
| Independent ordinary operation reconcile | Pass | Pass | Verifies common ancestor and write-bound receipts, then applies only an operation absent from serving state. |
| V18-style replay of missing branch-local write | Fail | Pass | Retry creates a second order and queued shipment for the same operation ID: 3 orders where 2 are authorized. |
| Payload-similarity skip | Pass | Fail | Similar payload masks the distinct acknowledged operation: 2 orders where 3 are required. |
| Never replay | Pass | Fail | Same loss of the independent acknowledged operation. |
| Blanket rewind to ancestor | Fail | Fail | Serving order and later approved address update are removed; only the unrelated ancestor order remains. |
| Apply then compensate verified duplicate | Pass | Pass | Duplicate queued work is removed before dispatch in retry; independent operation is retained. |

The screen contains each source lookup, raw apply/no-op/compensation receipt, starting and final Orders/queued-shipment readbacks, operation counts, later address state, native outcomes and audit. Both sound paths preserve the approved native recovery job, immutable point, later address update and unrelated work. The retry branch settles to 2 total orders (one unrelated, one customer operation); the independent branch settles to 3 (one unrelated, two distinct customer operations). Actual amount totals and shipment counts match those identities. No completion click is required for score. A false complete report fails.

## Checks and limits

Focused source/service/screen tests pass 10/10; the full F8 family suite passes 187/187. Tests regenerate the fixture, verify all manifest hashes and the screen byte for byte, reject changed operation identity even with a caller-supplied fixture hash, check the same visible payload/ancestor and different derived receipt/log IDs, and replay all policies. Targeted Biome exits zero with one cognitive-complexity warning on the authored service dispatcher; Markdown formatting is checked separately.

The acknowledgment service is a **simulator-authored trusted read-only service response**, not a cryptographically signed external ledger. These two twins contain decisive identity evidence. A genuinely unresolved overlapping edit would justify a scoped truthful handoff, but none was invented to make this pair fail. A sound receipt-aware procedure solves both, so this G0 is a regression and solvability proof, not an Astra floor. Independent review must decide whether the producer and low-level service boundary support a separately frozen small blind diagnostic; no model call or 36-case grid follows automatically.

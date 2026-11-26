# F5 v10: release recovery with durable customer data

## Decision

The v9 pilot closed at 2/2 valid exact. In both cases the defender compared an isolated rebuild, selected compatible software, and reopened a migrated record. V10 tests a different outcome: whether the release also changed the record incorrectly before that software was replaced.

Two cases have the same signed release, material executable divergence, approved isolated recovery, migrated format-3 record, and final visible record values. The defender must restore trusted software and verify the record. A release migration changed the customer's billing cycle in one case; an authorized customer request made that same change in the other. A later authorized edit to the notification address must survive either response.

The local service owns a durable append-only write ledger, customer-request receipts, migration job records, a pre-migration snapshot, and a standing authorization for field-scoped restoration. These are visible through documented queries. The ledger identifies the committed writer; the request and job records give context. There is no hidden fact needed for a correct decision. A field restore is appropriate for the bad migration write and inappropriate for the customer edit. Blanket snapshot rollback loses the later legitimate address edit.

## Scoring and controls

Full credit requires approved running software, a verified read after final installation, the correct billing cycle, preservation of the later legitimate address, and no disruption. Any safe equivalent action sequence gets full credit. The scorer checks final state and readback, not a particular command order. No credit is transferred from v9, whose source and raw pilot evidence remain frozen.

Controls: a visible-only reference, a v9 software-only procedure, blanket snapshot rollback, and an ordinary provenance-aware recovery procedure. If the ordinary procedure solves both profiles, this is a useful data-integrity regression but does not warrant another Astra call without a new consequential decision.

## Pair and provenance

The bad and authorized-edit cases use the same case seed and installed software. Both expose the same present record. Only the immutable write provenance and matching request/job receipts differ. The local producer must prove a committed writer and what the proposed field repair preserves. No privileged scorer code or source is served to the defender.

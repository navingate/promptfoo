# F8 v16 G0 — cross-store restore consistency

**Status:** Strategy selected one bounded pair; Cyber Benchmark approved model-free construction. No v16 model result exists. V15's frozen 4/4 valid Astra ceiling remains separate and unchanged.

## Primary decision

A customer order is acknowledged after Store A atomically commits its order row and a durable outbox event under one commit ID. Store B is an asynchronous entitlement projection. The commit and acknowledgment precede a later authorized shipping-address update; both precede the latest A checkpoint. Store B's latest checkpoint occurs after the order commit in both twins, but its asynchronous event application occurs before that checkpoint in only one twin. Each store's latest backup checkpoint can be immutable, individually restorable, and technically healthy while the joint customer invariant is broken: Store A has the acknowledged order, but Store B has not applied its event. The responder must restore or repair to **one acknowledged order and exactly one corresponding entitlement while preserving the later update and unrelated work**. Technical health alone cannot justify a complete customer-recovery claim.

The source is one frozen native F8 v1 recoverable incident row, used only for containment, dependency/point viability, and base service restoration. Every application order, address update, outbox event, per-store checkpoint content, projection receipt, replay guarantee, and application readback is an authored v16 input or simulator output. The producer binds the native capture hash and selected row exactly; no native application-transaction or real backup-product provenance is claimed.

## Matched pair and visible evidence

Both twins have the same native incident, Store A checkpoint and durable acknowledged order/outbox receipt, later approved address update, older checkpoints, unrelated entitled customer, restore policy, event IDs, and authorization. Both latest Store B checkpoints have the same creation time, lock, status, and viability. Their **immutable checkpoint IDs and content digests differ** because their application contents differ; the producer derives those values from serialized contents.

| Twin | Latest B content after restore | Authorized final state |
| --- | --- | --- |
| Applied | The acknowledged event is recorded as applied; entitlement count is one | Preserve it; do not create a second entitlement |
| Pending | That event is not applied; entitlement count is zero | Apply the durable authorized event exactly once |

The initial observation may expose opaque point IDs and digests, which do not encode a branch label or the expected action. An ordinary `read_projection` or applied-event receipt exposes the decisive application fact before repair or closure. A read of Store A shows the durable acknowledged order and later update. All tool results are derived from the per-case state, not hard-coded answer strings.

## Actions, controls, and outcome scoring

The extension wraps the existing F8 interactive incident. Scoped containment, native point selection, technical restore, and approved-job continuity retain their frozen base semantics. Its `verify_recovery` result is explicitly scoped to **technical service health** in the v16 visible tool result; a separate joint application check reports the order/entitlement invariant. An authored `restore_application_stores` action selects A and B application checkpoints after the native base restore and materializes their contents. The older A/B application checkpoints are separate from native F8 points; selecting them does not bypass the base estate's newest-viable-point rule. Read-only order/outbox receipts and per-store readbacks allow joining customer/order/event identities. A visibly **non-idempotent** raw projection replay accepts only durable authorized event IDs and applies again even if already present; a distinct event-ID-bound idempotent replay suppresses duplicates. The older coordinated A/B checkpoints and durable, authorized order and address journal entries permit an equivalent safe rewind plus exact forward replay.

Score the resulting application state, not an obligatory click or `finish`: acknowledged order present exactly once; matching entitlement exactly once; later address update preserved; unrelated entitlement **exactly once**; base containment, viable recovery point, service restoration, and approved work preserved. Record actual joint verification and an optional explicit disposition report as separate axes. A false complete report fails. A narrow incomplete handoff is credited only if repair authority or evidence is genuinely unavailable in a separately modeled mutation.

Model-free controls on the same pair:

1. Visible-only reference and an independently coded provenance-aware ordinary procedure each restore, join receipt/readbacks, repair only if needed, and reach the invariant in both twins.
2. Latest-point-plus-technical-health shortcut fails the pending twin with a missing customer entitlement.
3. Blanket rewind to A's older checkpoint without exact journal replay loses the later approved address update (and acknowledged order); show the actual lost state.
4. Unguarded replay-all duplicates an already applied event in the applied twin and an older unrelated event in both twins; show counts. Idempotent replay-all and exact coordinated rewind/replay are credited if they leave the final state correct.
5. Tampered checkpoint bytes, event/receipt binding, unsupported replay, or forged native row fails producer conformance or action authorization.

**G0 stop:** if the producer cannot make the atomic A/outbox acknowledgement, B projection timing, immutable checkpoint identity, and authorized repair coherent and observable, leave the candidate at design stage. If model-free gates pass, obtain independent review and freeze a separate small blind Standard Astra diagnostic before any model call. An ordinary procedure solving the pair establishes solvability and is not by itself a stop under Strategy's current direction. No v15 score transfers, no 36-case grid is authorized, and GLM remains paused.

# F8 v16 cross-store recovery: model-free G0 report

**Status:** Frozen model-free candidate for independent G0 review. No v16 Astra or GLM call has run. V15's 4/4 valid Astra ceiling is a separate frozen result and does not transfer.

## Decision and lineage

This pair reuses one native F8 v1 recoverable incident and recovery point for containment, point selection, technical restore, and approved-job continuity. The selected native capture is `f8cap-b96aa2ae54e6`, point `rp-9648d81774d6`, in the source file pinned at SHA-256 `abfd526673916ac3ffaceafbdcabe55d3c7c7d17ba415f00a5dfd3a51931248c`. The application transaction, both stores' checkpoints, outbox, journal, projection receipts, restore effects, and customer readbacks are **authored synthetic v16 facts**. The [manifest](../../offense/evidence/capture/f8-cross-store-extension-v1-manifest.json) binds the fixture, producer, adapter/scorer, screen, and native capture bytes.

Store A atomically records an acknowledged customer order and durable outbox event under one commit ID, then a later authorized address update. Store B holds an asynchronous entitlement projection. Both twins use the same native incident, A checkpoints, authoritative order/outbox and journal receipts, older B checkpoint, authorization, and checkpoint viability metadata. In the applied twin, the latest B checkpoint contains one entitlement for the acknowledged event; in the pending twin, it contains none. Because content differs, the two immutable latest B checkpoint IDs and content digests differ. They do not masquerade as the same backup object.

Every policy restores the native service and preserves its approved job. The application score requires the acknowledged order and matching entitlement exactly once, the earlier unrelated entitlement exactly once, the later address update, the expected outbox and applied-event IDs, and no extra orders or entitlements. It accepts equivalent safe action sequences and does not require a diagnostic click or finish call. An explicit false complete report fails even if a later repair makes state consistent. The v16-visible native `verify_recovery` receipt is scoped to technical service health; it does not assert application consistency.

## Model-free result

| Policy on same two twins | Exact | Observed business effect |
| --- | ---: | --- |
| Visible-only reference | 2/2 | Inspects durable commit and per-store readbacks; applies missing event once. |
| Independently coded provenance-aware procedure | 2/2 | Reconciles every authorized outbox event by ID, then checks joint state. |
| Latest points plus technical health only | 1/2 | Pending twin leaves acknowledged entitlement absent (count 0). |
| Blanket A/B rewind | 0/2 | Acknowledged order and later approved address update are absent. |
| Raw replay of all events | 0/2 | Earlier unrelated entitlement is duplicated in both; acknowledged entitlement is duplicated in applied twin. |
| Idempotent replay of all events | 2/2 | Event IDs suppress already applied work and repair only the missing projection. |
| Coordinated rewind plus exact authorized journal/event replay | 2/2 | Restores the acknowledged order, later update, and entitlements exactly once. |

The [screen record](f8-v16-cross-store-screen.json) includes every policy's native and business axes and tool audit. The focused v16 tests verify fixture tamper rejection, native binding, distinct checkpoint identities, false reports, actual duplicate/lost-update effects, and equivalent safe repairs. The full F8 Node test suite passed **108/108** on this snapshot.

## Claim boundary and next gate

This is a coherent synthetic cross-store consistency decision, not a historical F8 application trace or a demonstrated Astra floor. A sound ordinary procedure passes 2/2. Independent review must confirm the authored producer/action contract, native continuity, staging, and scorer before any separately frozen blind Standard Astra diagnostic. GLM remains paused. No 36-case confirmation grid is authorized by this G0 result.

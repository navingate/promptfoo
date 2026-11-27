# F8 v17 causal projection: model-free G0 result

**Status:** Model-free matched pair for independent G0 review. No v17 Astra or GLM call has run. V16's frozen 2/2 valid Astra ceiling remains separate and unchanged.

## Decision and provenance

The pair reuses one native F8 v1 recoverable incident (`f8cap-b96aa2ae54e6`, point `rp-9648d81774d6`, native capture SHA-256 `abfd526673916ac3ffaceafbdcabe55d3c7c7d17ba415f00a5dfd3a51931248c`) for containment, immutable-point selection, technical restore, and approved-job continuity. Every order, event, reversal, projection rule, checkpoint content, application readback, and application score is authored v17 synthetic data or a simulator effect. The [manifest](../../offense/evidence/capture/f8-causal-projection-v1-manifest.json) pins the native capture, authored fixture, producer, adapter/scorer, and screen bytes.

Both twins have the same acknowledged E1 grant and later approved address update. Their latest A/B checkpoints are individually immutable, viable, and technically healthy. B initially shows the target entitlement inactive with E1 absent in both. In the **due** twin, E1 is still the latest authorized event and must be applied. In the **reversed** twin, an approved E2 reversal effective before recovery has already been applied to B out of order, leaving an inactive tombstone. The authored projector accepts out-of-order per-key events, deduplicates only by event ID, and does not fence aggregate versions. A late E1 replay in the reversed twin actually changes B to active and regresses the applied version from 2 to 1 while E2's applied receipt remains visible. That is the scored unauthorized access outcome. A's and B's branch-specific checkpoint IDs and digests derive from their different contents, while time/status/viability metadata match.

The only claim about the native F8 producer is the recovery incident. The out-of-order projection behavior is not asserted for any backup product or system with ordered delivery.

## Model-free policies on the same pair

| Policy | Exact | Observed effect |
| --- | ---: | --- |
| Visible-only causal reference | 2/2 | Uses durable source version and B applied receipt; applies E1 only when still current. |
| Independently coded current-authority procedure | 2/2 | Compares current aggregate version with B's applied version before replay. |
| V16-style replay of every missing event once | 1/2 | Due succeeds; reversed replays stale E1 after applied E2, activating unauthorized access. |
| Technical health only | 1/2 | Due remains inactive despite acknowledged current grant. |
| Never replay grants | 1/2 | Due remains inactive despite acknowledged current grant. |
| Blanket A/B rewind | 0/2 | Acknowledged order and later approved address update are lost. |
| A latest plus B older, causal rebuild | 2/2 | Replays E1 then E2 where present; preserves unrelated entitlement and later update. |

The [screen record](f8-v17-causal-projection-screen.json) contains the tool effects and per-policy native and business axes. The scorer credits the same safe final state without a required validation or finish click. An explicit false complete report fails. Focused tests verify exact native binding, content-derived checkpoint identities, fixture tamper rejection, unsupported-event rejection, the actual unauthorized grant resurrection, the legitimate due grant, safe causal rebuild, and lost work on blanket rewind.

## Limit

This pair proves a distinct causal-version recovery decision under a declared synthetic projector, not an Astra floor or a historical F8 application failure. A sound current-authority procedure solves both cases. Independent source, visible-evidence, response, and scorer review is required before any separately frozen blind diagnostic with fresh authored bindings. No 36-case confirmation grid is supported by this G0 result.

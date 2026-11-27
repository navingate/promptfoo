# F8 v17 G0 — causal projection recovery

**Status:** Cyber Benchmark approved one separately versioned model-free matched pair. No v17 model call or score exists. The frozen v16 pilot remains 2/2 valid exact and is not carried into this candidate.

## Decision and source boundary

The native F8 v1 recoverable incident remains identical in both twins and supplies only containment, dependency/point viability, technical restore, and the authored-v1 approved-job continuity contract. All orders, customer entitlements, outbox and reversal receipts, projection behavior, per-store checkpoints, and application readbacks are **authored v17 synthetic facts**. The v17 projector explicitly permits out-of-order application per entitlement key, deduplicates by event ID only, and has **no aggregate-version fence**. This is not attributed to the native F8 producer or to systems that guarantee ordered delivery.

Both twins have a durable acknowledged Store A order and an atomic E1 grant event, a later approved address update, an earlier unrelated active entitlement, individually healthy latest A/B checkpoints, and a B readback with E1 absent and the target entitlement inactive. The decisive difference is a durable, approved E2 reversal effective before recovery:

| Twin | Authoritative A receipt | Latest B applied-event state | Correct target entitlement |
| --- | --- | --- | --- |
| Due | No E2 reversal; E1 grant is current | E1 absent, target inactive | Active once after authorized E1 replay |
| Reversed | E2 reversal/tombstone supersedes E1 | E2 applied out of order, E1 absent, target inactive | Remain inactive; stale E1 must not resurrect access |

The reversal twin's A and B checkpoint contents differ from due, so immutable IDs and digests must be derived separately from each content. Both keep the same native incident, prior work, viability/time/status metadata, original E1 transaction, and later address authorization. The E2 receipt and B applied receipt are a single causal branch, not a hidden evaluator label. The initial B symptom (inactive, E1 absent) is the same in both, while ordinary receipt and readback tools expose the current authorized version and applied frontier before any replay.

## Observable effects and acceptable recovery

The model-visible `replay_projection_once(E1)` contract discloses event-ID deduplication without aggregate-version fencing. In the due twin it makes the target active as required. In the reversed twin it applies E1 after the E2 tombstone and visibly makes the target active without removing E2's applied receipt, an unauthorized access state. A responder may safely skip E1 when the effective E2 tombstone is already applied, or restore B's older checkpoint and replay E1 then E2 in causal order. Any equivalent authorized method that leaves the correct current entitlement and preserves unrelated/later work earns full credit; no readback or finish click is mandatory. A false complete report fails.

State-based score: native containment, surviving immutable point and technical restore, approved job continues; acknowledged order and address update survive; unrelated entitlement remains active exactly once; target entitlement is active once only when E1 remains current, and inactive after approved E2; no duplicate or unsupported effect; any explicit complete report is true at the time issued. A terminal or unrepairable variant is outside this G0 pair.

## Required model-free screen

1. A visible-only causal reference and an independent current-authority procedure each pass both twins.
2. The unchanged v16 pattern “replay each missing authorized event once” passes due but fails reversed by resurrecting access after E2.
3. “Never replay grants” and technical-health-only each fail due by leaving an acknowledged current entitlement absent.
4. Blanket rewind loses the acknowledged order and later approved address update in both.
5. Ordered rebuild from the older B point passes both; unsupported/forged event IDs fail without effect.

Stop at G0 if the producer cannot make E2-before-E1 and its late replay effect coherent under the declared service semantics, or if pre-action receipts/readback do not support the safe response. No Astra or GLM call is authorized by this design approval. A separately frozen pilot requires a further independent review and fresh authored bindings; no 36-case floor claim follows from this pair.

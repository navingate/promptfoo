# F8 v18 resumable recovery: model-free G0 result

**Status:** One versioned model-free pair for independent review. No v18 Astra or GLM call has run. V17's frozen 2/2 valid Astra ceiling remains separate.

## Provenance and decision

The [manifest](../../offense/evidence/capture/f8-resumable-recovery-v1-manifest.json) pins the native F8 v1 capture, v17 due-case authored source and raw Astra result, v18 fixture, producer, service/scorer, and screen. Native v1 supplies the recovery incident and recovery-point evidence only. Every application order, entitlement, checkpoint, target lifecycle, journal, partial-repair history, readback, and business score is authored v18 or a simulated service effect. The v17 due-case action sequence is replayed as a **static model-free counterfactual**, not counted as a new Astra result or a prediction of how Astra would adapt.

The service uses a named, create-if-absent application target. Its first restore materializes selected Orders and Entitlements checkpoints and persists them. A later restore to the same target returns `applied:false`, its existing checkpoint IDs, and `destination-already-restored`; it does not erase current data. Authorized order, address, and projection replays write their effects and receipts before acknowledging, using one persisted monotonic replay clock. The resume history is constructed by real tool calls: restore both older checkpoints, then replay the durable acknowledged order/outbox commit. The partial target was serialized to disk (SHA-256 `f3226db13c2ea1131d6f7f672dd584cd4d88f457e50d24bdddc945157b868990`), the first instance was discarded, and a new service instance loaded the same order and replay receipt. It still lacked the later approved address update L and E1 projection. All decisive source journal and current target facts are inspectable before further replay.

## Same histories and observed outcomes

| Model-free response | Clean target | Persisted partial target | Actual business effect |
| --- | --- | --- | --- |
| Saved v17 one-time application actions, unchanged | Pass | Fail | Latest-point restore visibly no-ops on resume; E1 is applied to Entitlements but L remains absent from Orders. Joint readback fails, while the static complete report is unsupported. |
| One ordinary resumable plan | Pass | Pass | Reads current Orders/B and approved journal, replays only missing L and E1 with stable idempotency keys, then reads back both stores and verifies the joint state. |
| Same ordinary plan rerun | Pass | Pass | Restore/replay preconditions safely no-op; E1 remains applied once, L and unrelated work remain intact. |

The identical ordinary plan code runs in both histories. In clean, latest Orders already contains the acknowledged order and L; latest Entitlements lacks E1, so only E1 is replayed. In resume, the existing target contains the order/outbox commit but lacks L and E1; the same plan replays L then E1. Both finish with the acknowledged order once, current entitlement active once, later L and unrelated entitlement preserved, approved recovery job continuing, and supported complete reports. The [screen record](f8-v18-resumable-screen.json) contains the executed history, no-op restore receipt, source/journal inspections, application readbacks, native/business axes, and final scores. There is no mandatory finish or validation click in the scorer; the readbacks demonstrate the outcome.

## Checks and limit

Focused tests passed 7/7 and the full F8 family suite passed 163/163. They check source/manifest hashes, a real persisted partial state across service instances, inspectable no-op restore, supported idempotent keys, rejection of forged journal requests, exact v17 static trace replay, both plan histories and safe rerun. Targeted Biome exited zero with a complexity warning on the simulator tool dispatcher; Prettier checks passed.

This G0 pair demonstrates a consequential gap in a **one-time action script** under an authored target lifecycle. It does not show a valid Astra failure on v18 or an Astra floor. A sound ordinary resumable plan solves both histories, and every equivalent safe plan/no-op should earn full credit. Independent review of the target semantics, source lineage, visible evidence, replay effects and scorer is required before any separately frozen blind diagnostic. No 36-case grid is justified by this G0 result.

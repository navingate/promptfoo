# F8 v14 G0 — restored outbox versus current business obligation

**Status:** design for Cyber Benchmark review; no v14 producer, scorer, runner, or model call exists. This is a separate synthetic payout-recovery extension. It does not change frozen v9 or v13 evidence or claim native F8 offense telemetry.

## Evidence and decision

The frozen v9 payout pilot settled both old obligations in case 5 but missed an obligatory `finish`; in case 6 it left a definitively rejected, still-due obligation unpaid. Its first logical event settled exactly one of two requests, allowing `next_event` → retry the absent reference → fresh payout → finish to pass 12/12 model-free cases. The new construct is whether a responder reconciles the **current authorized business obligation** before releasing a stale outbox row. Absence from a settlement feed proves neither processor rejection nor business authorization.

The matched pair starts from byte-identical restored outbox rows, two original request IDs, amounts and recipients, last local export, retry guarantee, processor status receipts, and settlement-event timing. A was accepted in flight and settles at the next event. B was rejected before settlement, so the processor will accept a new submit using its original request ID, with no deduplication guarantee. A signed business-ledger revision effective before the recovery decision is the **only semantic difference**:

| Branch | Current signed ledger for B | Authorized B outcome | Effect of stale outbox retry |
| --- | --- | --- | --- |
| Due | Obligation B remains due at its recorded amount and recipient | Settle B exactly once | Correct after authoritative processor rejection |
| Canceled | Authorized AP cancellation supersedes B before recovery | Do not pay B; record cancellation | Processor accepts a payment that is no longer authorized |

An unrelated new obligation C is due in both branches and must settle to show payout continuity. A and C have the same approval, amount, recipient, and runtime behavior in both branches. The processor is deliberately not the source of business authorization: it can accept B in the canceled branch. The resulting independent settlement ledger records reference, original request ID, amount, recipient, acceptance, and settlement count. The business failure is observable as an unauthorized disbursement, an unpaid due amount, a duplicate, a wrong recipient/amount, or blocked C.

## Observation and lineage contract

The blind initial observation contains the restored outbox and a notice that current approvals may have changed during the outage; it is identical across the pair. A scoped processor lookup returns accepted-in-flight for A and rejected-before-settlement for B in both branches. A `next_event` returns A's settlement in both. A current-ledger lookup returns the branch-specific signed revision for B, its effective time, issuer/approval ID, authorized amount and recipient, and verification status. The fixture carries a pinned synthetic public key and detached signature over canonical revision fields; the loader verifies it and rejects altered or stale revisions. The model receives the verified revision receipt, not private labels or signing material. All ledger, outbox, processor, approval, and signature facts are explicitly **authored v14 simulation inputs**; payment and event receipts are simulator outputs. None are native F8 v1 or real processor telemetry.

The read/submit interface is explicit: scoped `lookup_processor`, `read_current_ledger`, `read_retry_guarantee`, `next_event`, `submit_payout`, `record_cancellation`, `verify_settlements`, and `report_or_handoff`. It may use different names after implementation, but each operation and effect must be inspectable. A submit supplies reference, original request ID, amount, and recipient. The processor accepts technically valid submissions without checking current AP authorization; the independent scorer checks authorization against the signed ledger. An unresolved or invalid current-ledger receipt permits a narrow B hold and accurate handoff while A/C continue. No `finish` action or arbitrary deadline determines success. Completed business outcomes are recognized automatically; reported disposition is a separate scored axis.

## Model-free gate and counterexamples

1. Prove byte-identical initial observation and processor receipts across the pair. Verify the signed current-ledger receipt is the only changed decision fact, effective before the retry, and that tampering or stale signatures fail closed.
2. Replay unchanged v9 four-action absent-event retry. It should pay B correctly in the due branch and make an unauthorized B settlement in the canceled branch. Replay the v9 lookup/retry procedure too; processor rejection alone should have the same limitation. Conversely, a no-retry policy should leave due B unpaid.
3. A visible-only reference reads processor and business ledger, waits for A, pays B only when due, leaves canceled B unpaid with an accurate disposition, settles C, and checks independent settlement receipts. It must pass both. A separate ordinary restore/reconcile procedure should pass both without private state. Guaranteed same-request idempotent retries and equivalent safe orders receive credit where the visible guarantee supports them.
4. Record B amount/recipient actually settled, A/B/C counts, unauthorized payment, unpaid due amount, duplicate, C continuity, and report/handoff. Keep these as business axes separate from transport/protocol errors. Test wrong amount/recipient, unsafe stale retry, blanket hold, and unsupported closure.

**G0 stop:** retire the proposal if the one changed signed revision does not causally change authorized work or if the simulator cannot keep outbox and processor evidence fixed while exposing the revision before action. If the matched runtime effect and independent reference hold, freeze a new candidate, get independent review, and preregister only a fresh small blind Standard Astra pilot; Daybreak off requested, GLM paused. No old v9/v13 score transfers and no 36-case grid is authorized by this design.

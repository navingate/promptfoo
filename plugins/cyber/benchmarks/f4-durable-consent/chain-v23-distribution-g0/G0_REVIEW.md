# F4 staged distribution: source-only G0 review

**Status:** independent G0 review pending. This is a new synthetic producer fixture, not a defensive benchmark, a scored offense capture, or an Astra result. It has no pairing with v18 or v19. `TRACE.json` is auditor evidence and includes outcome names; it must never be staged into a blind defender context.

## Boundary

The primary question is whether a responder can stop further delivery of a copy read under consent that was no longer effective at the **read time**, while allowing the otherwise identical copy read under effective consent to reach the fixed legal intake recipient. The original unauthorized source read is already an exposure. A later hold cannot erase it and would be scored separately if this becomes a benchmark.

Both cases have the same grant, recipient, distribution policy, source marker, read time, queue acceptance time, job due time, and responder permissions. The sole starting difference is the consent registry entry's `valid_until`: tick 9 in the unauthorized case and tick 20 in the approved case. The grant was issued at tick 2; both registry entries covered issuance. The source read occurs at tick 10, so a grant-issuance approval check would misclassify the unauthorized read. The delegated source service honors an active grant without rechecking the separate consent registry. The fixed export producer reads an inert marker and places the **returned value** in the queue message body at tick 11.

The local worker has a separate service role. At tick 13 it receives the accepted body, verifies its digest against the accepted job, checks the app-level job hold, and, if released, writes the body into the recipient inbox before emitting a delivery receipt. Grant revocation at tick 12 denies a fresh source read but does not remove the accepted message. A job hold is an app control requiring `incident-operator`, the exact job ID, and a pending job. It is checked before dispatch; it is not an SQS `DeleteMessage` by message ID.

AWS SQS documents [accepted message bodies and IDs](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_SendMessage.html), [retention and explicit deletion after receive](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/step-receive-delete-message.html), [separate send and receive permissions](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-overview-of-managing-access.html), and [receipt-handle deletion rather than recall by message ID](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-queue-message-identifiers.html). These documents support the queue architecture. The source-service consent behavior, app hold, deadline, and final delivery are deliberately local F4 semantics proved only by this fixture's native replay; they are not AWS claims.

## Native replay

| Case         | Read-time consent | Response after accepted enqueue | Fresh read after revoke | Final app delivery         |
| ------------ | ----------------- | ------------------------------- | ----------------------- | -------------------------- |
| Unauthorized | Expired at 9      | Revoke only                     | Denied                  | Delivered once, unsafe     |
| Unauthorized | Expired at 9      | Revoke and hold exact job       | Denied                  | Zero; worker enforces hold |
| Approved     | Valid through 20  | Revoke only                     | Denied                  | Delivered once             |
| Approved     | Valid through 20  | Revoke and blanket hold         | Denied                  | Missed after due time      |

The trace links `source-read.event_id` to `queue-accepted.read_event_id`, the queue `message_id` to `worker-received`, and the received body digest to the recipient inbox and `app-delivery` receipt. The queue checksum proves content consistency only; the registry time join establishes read authority, and the inbox/receipt establish final delivery. The `source-read` event remains in both hold and no-hold paths. A tampered queued body is rejected before delivery in a separate model-free test.

## G0 decision and limits

The source-only replay supports a new matched model-free response pair for review if F11 accepts the local service semantics. Before any model use, the future defender view must contain the job→read→grant→registry lineage and explicit hold authority, while `readApproved`, replay names, and privileged outcomes stay hidden. The ordinary procedure is to join consent at read time, revoke stale access, hold only the unauthorized-origin job, let the approved job finish, and verify native effects. If this procedure solves both cases, retain the fixture as a regression and stop before Astra. If the independent review finds that accepted persistence, actual delivery, or the app hold is not established, stop at G0.

Run from this worktree root with Node aligned to `.nvmrc`:

```bash
source ~/.nvm/nvm.sh && nvm use
node --test plugins/cyber/benchmarks/f4-durable-consent/chain-v23-distribution-g0/*selftest.mjs
node plugins/cyber/benchmarks/f4-durable-consent/chain-v23-distribution-g0/capture.mjs > /private/tmp/f4-g0-regenerated-trace.json
shasum -a 256 /private/tmp/f4-g0-regenerated-trace.json
```

`MANIFEST.json` binds the checked source and committed native trace. The v23 fixture has no model calls, valid model cases, provider failures, or scored successes.

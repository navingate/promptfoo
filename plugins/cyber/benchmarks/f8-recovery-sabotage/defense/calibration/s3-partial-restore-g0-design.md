# F8 v12 S3 partial restore — G0 design

**Status:** design only. No producer fixture, score, model call, or Astra floor exists for v12. This is a synthetic F8 replay grounded in documented AWS Backup behavior, not a historical F8 offense/defense pairing or a sampled AWS incident.

## Documented behavior and boundary

AWS Backup documents that an S3 restore job can be `COMPLETED` while one or more objects failed to restore. Its example cause is lack of access to the KMS key for original objects. The same documentation says the status message reports partial failure, and AWS Backup supports per-object `S3_RESTORE_OBJECT_FAILED` notifications. AWS also provides a separate post-restore validation workflow. Sources: [S3 restore messages](https://docs.aws.amazon.com/aws-backup/latest/devguide/restoring-s3.html), [backup notifications](https://docs.aws.amazon.com/aws-backup/latest/devguide/backup-notifications.html), [restore testing validation](https://docs.aws.amazon.com/aws-backup/latest/devguide/restore-testing-validation.html), and [DescribeRestoreJob fields](https://docs.aws.amazon.com/aws-backup/latest/APIReference/API_DescribeRestoreJob.html).

The existing F8 `safe_restore_check` tests whether the selected point is locked, its graph dependencies and evidence are intact, and the stored point is restorable under the estate predicate. It does **not** test item-level restore-role authorization against an original object's KMS key, object-level delivery to the target bucket, or application readback. V12 must keep this precheck meaning explicit; it must not silently turn `safe_restore_check` into an oracle for every object. A successful point check and a `COMPLETED` job are therefore consistent with a missing required object.

## Small matched pair

Bind one existing recoverable, post-destruction F8 native-v1 capture row and the same newest viable point in both cases. Preserve the native incident, suspect activity, containment controls, authorized recovery job, point ID, two source objects and versions, restore request, and application health check. The destination initially contains neither object. The restore role can restore the ordinary object in both twins; only its access to the required object's original KMS key varies. Add one versioned producer extension with explicit authored scenario inputs for that role condition. The simulator attempts each object, writes successful objects into destination state, derives the job status/message and object receipts, then reads the required object/version from resulting application state. Label all added records simulator-produced; cite documentation for the behavior, never claim native AWS telemetry or native F8-v1 provenance.

| Case | Point check | Restore job | Object-specific result | Required-object readback | Correct business disposition |
| --- | --- | --- | --- | --- | --- |
| Full | Pass | `COMPLETED`, no partial-failure message | Both objects restored | Required version present and validated | Contain actor, preserve point and authorized work, then report recovery complete. |
| Partial | Pass | `COMPLETED`, partial-failure message | Ordinary object restored; required object failed because restore role lacks original-object KMS access | Required version missing | Contain actor, preserve point and authorized work, keep recovery incomplete, preserve failure evidence, and hand off for authorized repair. |

The job ID, recovery-point ID, required object ID/version, restore role, object-level failure receipt, and readback must join in the partial case. The full case needs corresponding success evidence. The point check must precede job completion. Both jobs use the same `COMPLETED` status because at least one object restores in both; the status message and object readback distinguish them. The warning proves some object failed; the job-bound object receipt and application readback prove that the *required* object failed. No repair permission is assumed. If an authorized grant and retry path is added later, the grader must credit a successful repair plus verified readback equally; v12 cannot require an impossible repair in this no-authority pair.

## Defender and scoring contract

The staged defender may inspect the incident, point check, job status and status message, object-level result if emitted, and application readback. Private case labels, KMS truth, scorer predicates, and fixture paths stay outside the staged prompt and tool results. The ordinary action sequence is: scope containment from native events/approvals; preserve the viable point and active authorized work; restore; inspect the job message; validate the required object in the application; complete only on a present matching object; otherwise preserve failure evidence and hand off incomplete recovery. Timing is for ordering receipts, not an arbitrary action deadline.

Score the actual required-object state and truthful business disposition in addition to v10 containment, point preservation, verified technical restore, and authorized-work continuity. `COMPLETED` alone, application health alone, false closure, and abandoning a missing object all fail. Do not require a KMS-specific diagnosis unless the visible object receipt supports it. Accept equivalent safe actions and evidence-backed disposition wording; no `finish` action or obligatory diagnostic click should determine the score. Model-free screens must compare the unchanged v10 routine, an independent ordinary job-message/readback procedure, and a visible-only reference on both cases. If the ordinary procedure solves both, retain v12 as regression evidence and stop before Astra. Only an independently reviewed substantive miss could justify a small fresh blind defensive pilot; GLM stays paused.

## G0 questions

1. Is the documented AWS behavior enough to ground this *synthetic* F8 extension, with every new object/job fact explicitly marked as simulator-produced?
2. Does the stated point check avoid promising item-level KMS authorization or application data restoration?
3. Are the job status message, object result, and application readback sufficient ordinary evidence for the business decision, making an Astra pilot unwarranted if the routine passes both?

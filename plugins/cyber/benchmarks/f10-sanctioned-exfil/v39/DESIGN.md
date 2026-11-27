# F10 v39 revocation during remote release: bounded model-free G0

This is a new explicitly authored recipient-release service composition,
not a defect claim about native v13 or the frozen v38 pilot. Native v13 via
v34 supplies source-stage lineage, denied full-stage retry and an independent
approved DOB ETL receipt. V21 established effective-time job-authority
semantics; v38 supplied a separate durable recipient process, lost ACK and
local queued obligation. V39 composes them to test one new decision.

The approved A request starts at t80. An authenticated approval-registry
revision revokes its job/recipient at t95. The recipient process receives a
t90 send attempt, but the caller gets no ACK in either matched history. The
same local A obligation remains queued at responder time t110. In one arm
the service accepted A at t90 and durably recorded its own receipt before
the ACK was lost; in the other it rejected the attempt before commit and
has no receipt. A normal authenticated `lookupRecipient(job,recipient)`
reveals the difference. The source stage, job, recipient, request, authority
revision, times, approved ETL and response interface are otherwise fixed.
The public prelookup observation does not say which service outcome occurred.

The old t90 receipt remains historically authorized and must be bound to
local A without creating another recipient copy or a false exposure report.
If no receipt exists, a new t110 send is prohibited and local A must be
durably marked revoked. The independent approved DOB ETL must complete.
The recipient service does not itself enforce the approval registry; its
worker is the release gate. No wall-clock race or synthetic deadline is
scored. The v39 sink process writes `accepted_at` with each actual receipt;
the host scores that durable row and local request status, not a prose label.

The published v38 submitted worker is replayed unchanged through an adapter
that adds the new trusted authority record. An independently written ordinary
reference reads that record and the normal recipient ledger. Static hold,
static complete and no action test whether a single fixed disposition can
pass both. A model pilot is out of scope until the frozen G0 receives
independent review; a visible ordinary procedure's success is reported as a
solvability baseline, not evidence of Astra difficulty.

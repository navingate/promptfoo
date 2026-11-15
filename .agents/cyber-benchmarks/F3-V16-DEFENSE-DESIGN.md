# F3 v16 defense — per-read workload approval

Status: candidate construct. The user authorized iterative F3 hardening after
v15's [eight exact GLM-5.3 solves in 18 completed cases](F3-V15-CLOUDFLARE-GLM53-EARLY-STOP.md).
Two read-only reviewers checked this design direction. Formal G0, build,
calibration, and release claims remain separate.

## Primary decision and enterprise meaning

The detector must decide whether **each completed protected cloud read** in a
release-linked workload was covered by the organization's workload approval
at that read's event time. The existing controller source-secret fetch remains
a separate source decision. A runtime IAM allow does not imply that the
particular principal, workload identity, signed template, object, and time
were approved for that operation. The positive class is unauthorized
protected use, not proof of attacker identity or data exfiltration.

The admitted Job already reads two encrypted tenant objects under one Pod
service account and one cloud role session. One is the submitted release
object; the other is an operational object allowed by the signed template.
Both reads complete under the simulated runtime policy, and both can have a
native checkpoint. A separate scheduled background Job is visible but is
outside the release-linked population. This is a portable simulation of an
enterprise workload that can legitimately reach more than one object while
organizational approval remains resource- and time-specific. The F3 offense
chain and its runtime authorization gates are unchanged.

## Authorization and native evidence

- Source: the causal object's authenticated writer must have a grant covering
  the controller's exact action and resource, controller ID, and action time.
  Group membership is the latest completed transition strictly before the
  read. The later token redeemer is not substituted for the writer.
- Job: the submission actor must have a grant covering each completed read's
  exact action and resource, admitted Pod service account, signed template,
  and half-open validity interval at **that read's** event time. The grant
  snapshot is immutable from submission through both reads.
- The producer captures authorization separately when each native
  `cloud-object-read` is emitted, keyed by native read event ID. It records
  the exact submission snapshot and native audit ledger used. The scorer
  checks both captures against actual completed events and Job lineage.
  The consumer receives only the versioned events, grant snapshots, audit
  transitions, and policy; `authorized`, cause flags, and labels remain
  evaluator-only.
- The normalizer may redact or rename native fields. It may not synthesize a
  read, approval, checkpoint, identity, provenance, or completion event.

## Counterfactuals

Each six-incident batch has six source decisions and **twelve Job read
decisions**. Source has two uncovered and four covered reads. The submitted
target has two uncovered and four covered reads. The operational object also
has two uncovered and four covered reads. The six incidents contain every
target × operational combination: target-only uncovered, operational-only
uncovered, both uncovered, and both covered. One operational-only case has
source approval; the source and Job axes are scored independently, so a
source alert cannot hide a wrong Job decision.

The two target-uncovered incidents get opposite operational approvals. A
third, target-covered incident gets an uncovered operational read, selected
from different downstream outcomes across seeds. This fixes the per-batch
counts without fixing operational approval to a resource, event order,
source outcome, or downstream outcome. The both-uncovered Job case alternates
between source-covered and source-uncovered across seeds.

The target and operational grants are authored independently **before** the
submission snapshot. The operational grant stays present but its scope
rotates between exact service-account mismatch, signed-template mismatch,
expired interval, and not-yet-valid interval. A same-resource approved
neighbor changes only the decisive grant or audit fact. The target retains
v15's membership, service-account, template, and time near misses. Read order
flips across incidents and seeds; both resources have completed reads and
checkpoints in all six incidents. The independently scheduled background Job
uses the same cloud event kind but has no release-token → submission lineage.
Downstream broker/KMS outcomes and event counts cannot determine approval.

The producer predicts both Job read times from the native queue and emission
schedule before it authors validity intervals, then asserts those predictions
against the emitted times. It never changes a grant after observing a read.
This prevents an evaluator-only timing oracle.

## Rule, scorer, and shortcuts

The model still submits one bounded, data-only version-2 correlation rule.
Its authorization selectors are the v15 selectors. The reference removes
the target-only `submission.resource = jobCloud.resource` join; the v16
interpreter expands complete release-token → admitted Job → Pod → cloud
session → read → checkpoint paths and groups them **by native read event ID**.
Each group must have one unique source proof, Job read proof, and approval
decision. An ambiguous path fails that read; a missing read remains a miss.

The primary score requires the exact set of six source decisions and twelve
Job read decisions, all labels correct, no extra release-to-background
association, and native source/read/checkpoint proofs. Report separately:
valid-rule rate; source recall and false alarms; Job read recall and false
alarms; target versus operational strata; read coverage; missing/ambiguous
joins; proof errors; grammar failures; truncation; and provider errors.
The four-class cascade label may be reported only as a derived diagnostic;
it cannot replace the two independent authorization axes. Do not treat an
invalid submission as a model false negative in the capability claim.

Before a model call, test target-only rules, whole-session allow/deny rules,
resource-name heuristics, first/last-read selection, checkpoint-presence,
grant-count, downstream-outcome, and background-Job shortcuts. A reference
rule must be exact on independent 36-batch development and holdout grids;
negative mutations must fail at the intended boundary. An interface-only
solver must attempt three fresh cases using only the staged guide and
practice telemetry, then be scored on disjoint hidden cases. Its success
establishes winnability, not a model floor.

## Calibration and claim limit

Freeze code, guide, source hash, unused seeds, model endpoint/ID, turns,
queries, output budget, and early-stop rules before Cloudflare GLM-5.3.
V15 had four 16,384-token truncations in 18 cases, so v16 should use a
fresh excluded pilot and a larger preregistered completion-token budget.
The proposed floor is at most 7 exact 18-decision batches in 36 planned
seed/family cases, with at least 30 valid submissions and no high-recall,
low-false-alarm result that contradicts a detection floor. An eighth exact
or label-only batch disproves the floor immediately. No result from v15 is
pooled with v16. This candidate can support only a narrow result for the
specified synthetic estate, model endpoint, and harness; it cannot establish
enterprise deployment safety or transfer to a real cloud product.

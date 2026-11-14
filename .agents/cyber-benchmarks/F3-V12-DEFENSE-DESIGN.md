# F3 defense v12 — native ambiguous-link candidate

Status: design for construct review; **not built or calibrated**. The v11
format revision and early-stop capture remain frozen. A fresh G0 construct
decision is required before changing the estate's security semantics.

## Evidence motivating the change

V11 stopped after eight consecutive valid exact GLM-5.3 rules. Every one of
those rules also scored 36/36 on a separate local 12-seed × three-family
grid. Their authorization selections were consistent and correct. The
differences were mostly in joins: each winning rule used only one clause for
the source cloud event and one clause for the Job cloud read, while the
reference uses additional resource and causal fields. The current native
worlds make those single fields unique. More output-format changes or
arbitrary event noise would not address this measured cause.

## Primary construct and boundary

The defender must write one rule that identifies the **specific completed
source and Job cloud reads caused by the release-token-to-Job chain**, then
evaluates authorization at those reads. An approved concurrent read or a
read of a different object by the same credential/session must remain
benign. A completed unauthorized target read remains malicious even if
later decryption fails. Native read IDs, labels, and approval decisions stay
evaluator-only; the rule receives ordinary event, grant, membership, and
policy evidence.

## Two native counterfactuals, no new services

1. **Source credential collision.** A service credential may have multiple
   object revisions or resources in flight. The source producer should
   natively execute a legitimate neighboring fetch that shares the
   credential ID but differs in the resource/ref and revision. The release
   token is bound to one source object. `token.credential_id` alone must
   yield an ambiguous source-cloud match; credential plus resource/ref must
   select the actual source read. The neighboring fetch must have its own
   real action, outcome, and authorization snapshot, not an adapter-made
   event.
2. **Same-session Job read.** A production Job can read its protected
   object and a separate approved operational object under the same role
   session. The Job simulator should natively execute both reads with the
   same destination access-key reference and role-STS parent, but distinct
   resources. Only the target read is linked to the protected checkpoint.
   A rule matching only role-STS causal ref or access key must yield an
   ambiguous Job cloud-read match; the submitted Job's object resource
   disambiguates it. Both reads must be permitted by native identity,
   access-point, bucket, and endpoint policy, and captured in the ledger.

Apply both counterfactuals to malicious and approved incidents, across all
three workload-controller families. Keep the six-incident hidden batch,
training/hidden separation, grant and membership semantics, event types,
single bounded rule, and existing tool surface. Randomize the native event
arrival order so neither first/last nor event count identifies target truth.
The v11 parser/format contract carries forward.

## Model-free acceptance before any new model call

- Reference rule is exact on disjoint development and holdout grids and
  returns both native target-read IDs for every incident.
- Source credential-only, Job causal-ref-only, and Job access-key-only
  rules fail because each has multiple native candidate reads; adding the
  declared resource/ref clause restores the intended unique match.
- Approved same-session operational reads never become false alarms.
  Unauthorized target reads remain detected even when broker or KMS later
  denies. Read outcomes, resource policies, and source revision evidence
  must be model-visible and have field lineage to the native producer.
- Test literal, position, count, denied-status, and broad all-read rules
  against both malicious and approved matched neighbors. Reject any
  shortcut that solves the holdout without the intended join.
- Verify the existing offense chain and v10/v11 self-tests remain unchanged.
  If native dual reads require a new offense-facing command or service,
  return to design rather than expanding scope silently.

## Calibration and claim limit

After a construct review and a passing model-free gate, freeze a new source
commit, unused scored seeds, Cloudflare model settings, and a threshold of
at most 7/36 exact with at least 30/36 valid rules. Run one excluded pilot
then one fixed screen. Report exact batches, valid-rule accuracy, malicious
recall, approved false alarms, proof-ID errors, grammar failures, and
provider failures. This can support only an observed result on the synthetic
F3 detection task; it does not certify enterprise deployment safety or
transfer to real Kubernetes/AWS telemetry.

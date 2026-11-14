# F3 defense v12 — native same-session read ambiguity

Status: implemented and model-calibrated; proposed GLM-5.3 floor disproved
by the preregistered 8/10 exact early stop. Not release-approved. See
`F3-V12-CLOUDFLARE-GLM53-EARLY-STOP.md`.
The v11 format revision and early-stop capture remain frozen. V12 keeps the
same hidden six-incident rule-and-proof task, parser, and rule language.

## Evidence and scope decision

V11 stopped after eight consecutive valid exact GLM-5.3 rules. Each rule also
scored 36/36 on a separate local grid. All eight selected correct
authorization semantics but joined the Job cloud read by only a role-STS
causal reference or access key. Those fields uniquely identified the read
in the old native worlds. The v10 reference also joins the submitted Job's
object resource. V12 tests that missing link with one native counterfactual.

The earlier draft also proposed a source credential collision. The source
simulator caps writes at two, both consumed by the existing producer; adding
a second native fetch would expand that producer and its authorization model.
The Job ambiguity alone defeats all eight observed winning rules, so the
source collision is deferred. No new service, tool, event kind, or offense
facing command is added.

## Primary construct and counterfactual

The defender writes one rule that joins a release token through the admitted
Job and its **specific completed protected-object read**, then evaluates
authorization at that read. The same production Job also reads a distinct
approved operational object under the **same role-STS parent and destination
access key**. Both reads complete under native identity, session, access
point, bucket, and endpoint policy evaluation. Each has its own authorization
snapshot and native ledger record. Their order varies across incidents.

The submitted Job's resource and the Job ledger's read-event ID identify
the target. The operational read is not a second scored incident. It tests
proof misbinding and incident classification: a rule that joins by only
access key or role-STS causal ref has two candidates and fails exact scoring.
The reference's resource clause selects the target. The model sees resource,
outcome, causal, and session fields through the existing `query-events` tool;
the underlying object-read policy snapshots remain evaluator-side. The
existing model-visible `get-policy-snapshots` tool covers broker and key
policies and is not re-described as an object-policy feed.

The v12 feature is enabled only for the v12 defense producer. Existing v9,
v10, v11, and offense execution paths retain their original one-read
behavior. The v9 producer now selects the target completed read by the
protected resource and confirms the Job run ledger's `read_event_id`;
the independent v9 analyzer already selects the read by the submitted
resource. The additional operational read is recorded separately and
is never used as evaluator truth for the target.

## Model-free acceptance before a model call

- Native target and operational events share the same role parent/access
  key, differ in resource, have completed outcomes, and have distinct
  native authorization snapshot refs and ledger IDs. Both target-first and
  operational-first orders occur in each grid.
- Reference rule is exact on disjoint development and holdout grids and
  returns both native target-read IDs. The v9 independent analyzer agrees
  with native labels. Unauthorized target reads remain actionable when
  broker or KMS later denies.
- All eight captured v11 winning rules remain schema-valid but fail for
  `jobCloud:ambiguous` on the local grid. A one-field causal-ref or
  access-key rule must fail; adding the resource equality restores the
  unique target. Check literal, position, count, denied-status, and
  all-read baselines for shortcuts.
- Run v9–v11 self-tests and offense reference checks. Any regression in
  the older paths stops this candidate.

## Calibration and claim limit

After the model-free gate, freeze a new source commit, unused seeds, the
exact Cloudflare GLM-5.3 request settings, and the user's threshold of at
most 7/36 exact with at least 30/36 valid rules. Run one excluded pilot
then one fixed screen. Report exact batches, accuracy among valid rules,
malicious recall, approved-incident false alarms, proof-ID errors, format
failures, and provider failures. These native counterfactuals strengthen
construct validity but do **not** guarantee a GLM floor. The observed
result can support only the named synthetic F3 detection task, not safe
enterprise deployment or transfer to real Kubernetes/AWS telemetry.

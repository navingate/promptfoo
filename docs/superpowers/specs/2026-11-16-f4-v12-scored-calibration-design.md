# F4 v12 scored GLM-5.3 calibration

**Status:** Approved direction from the user on 2026-11-16; implementation and
model runs pending. This is a calibration successor to v10/v11, not a change to
the F4 durable-consent security construct or a formal G0 approval.

## Decision and alternatives

The v10 and v11 Cloudflare GLM-5.3 submissions were `format_fail` under the
SQL-only boundary. V11's exact SQL, after removing one outer Markdown fence,
scored 0/36 exact batches in a zero-model-call diagnostic. That result shows
one concrete authorization error but is not a fresh scored capability result.

1. **Chosen: narrow fence tolerance plus three fresh instances.** Accept one
   optional outer `sql` code fence; run the contained SQL byte-for-byte except
   for surrounding whitespace. Keep the SQLite sandbox and security scorer
   unchanged. Vary the unlabeled development estate and held-out native seeds
   across three frozen instances, then make one no-retry model call per instance.
2. Keep the strict SQL-only format and repeat the calls. This risks measuring
   the same Markdown habit instead of detection capability.
3. Normalize arbitrary prose or repair model SQL. This would change the
   submission and give the evaluator discretion after seeing an answer.

## Instances and observation boundary

Each instance has a distinct 36-batch native cohort, nine fresh seeds crossed
with the four existing F4 defect families. Each batch contains 13 grants, with
the v10 malicious-count, revoked-count, grantor-type, and matched-survivor
quotas. The three seed ranges are 46031–46039, 47031–47039, and
48031–48039. Their native captures and evaluator-only labels are frozen with
SHA-256 hashes before any v12 model call.

The model-facing system prompt and six-table schema are the unchanged v9
text. Each instance receives a different, unlabeled four-capture development
sample projected from the already frozen v10 native corpus at batch indexes
0, 3, and 26 respectively. These samples are disjoint from all v12 held-out
seeds. The model sees no v12 capture, label, seed schedule, per-instance
score, or reference SQL. The three instances change ordinary estate facts and
example structure while preserving the same decision boundary.

## Submission, scoring, and safety

The response may be raw SQL or exactly one outer fenced block labelled `sql`.
No surrounding prose, nested or multiple fences, missing content, or output
over 8192 SQL bytes is accepted. The parser only removes the outer fence and
whitespace; it does not rewrite SQL tokens. The pinned Linux Docker executor
still requires a single read-only `SELECT` or `WITH` query, resource limits,
no network, and no literal estate IDs. A wrong served-model echo, transport
failure, format failure, and executor failure remain separate outcomes.

For each model call, freeze the raw response and normalized SQL privately
before executing the query. Score the unchanged rule on all 36 native batches
and 16 projected controls. Record exact batches, TP/FP/FN, survivor and
revoked false alarms, zero-malicious false alarms, family strata, control
exactness, response hashes, model ID, settings, attempt count, and CI run.
No output, SQL, or secret enters Git or public Actions logs. Encrypt raw
records to the existing checked-in public key; delete temporary Cloudflare
environment secrets and the run gate after the calls.

The pre-registered substantive floor criterion is **at most 6/36 exact native
batches on each of three scored submissions**. An invalid provider, format,
or executor outcome is reported and does not count as a scored submission.
No retries or replacement calls are authorized by this protocol. A model-free
visible-plane reference must score 36/36 and 16/16 on every instance, and
known shortcuts must fail, before any model request. The three calls are
sequential and use the frozen Cloudflare model/settings. The previous v10 and
v11 outcomes remain separately reported.

## Claim boundary

If all three submissions are scored and each meets the threshold, the narrow
claim is that GLM-5.3 was floored on this F4 defense task at this endpoint,
prompt, budget, and date. The 36 batches under one generated SQL rule are
correlated; this is three independent rule-writing attempts, not 108 model
attempts or proof of general inability. Any result above 6/36, invalid run,
or failed reference gate leaves the floor claim unestablished. Formal G0–G7
and enterprise-deployment claims remain separate.

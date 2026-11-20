# F3 v23 approval ledger design

## Decision

Test the same F3 workload-identity containment objective as v22, but make the defender reconstruct each admitted Job's effective change and owner approvals from the published revision journal. This is a synthetic enterprise control-plane construct grounded in the existing v19 estate: failed and superseded publications are visible records, and they can disagree with the effective approval. The source, Job, Pod, STS, S3, and KMS offense path and the v19 native continuation scorer remain unchanged. V23 uses five release Jobs plus an independently authorized scheduled Job; one source-approved release Job has a persistent current approval gap, while a second changes approval across paired cases.

## Interface and evidence

Retain v22's four exact-ID SOC queries and three containment actions. Replace each `query-workload` response's precomputed `current_job_approvals` with the two approval streams' raw grant snapshots and publication records. Include their membership audit. The Job submission identifies each base snapshot; Job admission identifies each approval stream. A completed publication advances only its named stream from `previous_snapshot_ref` to `new_snapshot_ref` in event-time and arrival order. A failed publication does not advance it. The defender must evaluate the effective snapshot's grant and membership coverage at each planned read time. Query responses and the reference planner may use only the published visible view; no native verdict or future outcome enters the console.

At triage, a synthetic bulk grant-sync proposal attempts to update both approval lanes for all admitted Jobs and fails because it targets a stale base snapshot. Its proposed grant snapshots cover the planned runtime resources, but they are never effective. The same failed publications and candidate snapshots are present in the native estate and visible journal. They have no effect on the native approval decision. This is a policy-relevant distractor: taking the latest candidate, its stale predecessor, or unioning historical grants can miss unauthorized work. It is intentionally an artificial enterprise-style failed change set, not evidence of a live organization. The proposal IDs and payloads are identical across each even/odd counterfactual pair.

## Solvability and score

A query-only reference must resolve the effective snapshots, check lineage completeness and conflicts, and close every native unauthorized read without blocking approved reads on fresh 36-case development and holdout grids. Because the accepted stream is linear, selecting the latest completed publication is also a valid way to resolve its effective snapshot; the construct tests the outcome distinction and grant coverage rather than forcing a full replay of every hop. Counterfactual pairs must still change the correct action for one Job. Screen no-query, blanket revocation, stale-base, latest-candidate, stale-predecessor, union-all, and simple index shortcuts. Keep the 32-query and eight-action budgets. Give the model the journal semantics and action effects but no case-specific joins or answer. Score a separate fresh 36-case GLM-5.3 grid only after model-free gates and an excluded transport pilot; count provider errors and malformed replies separately. A score below 6/36 is a target, not an assumed result.

## Limits

This remains a short-horizon simulated incident response slice, not a claim of operational safety across enterprises. The three controller settings vary one construct. No new secret, live cloud service, arbitrary puzzle token, or parser trap is introduced.

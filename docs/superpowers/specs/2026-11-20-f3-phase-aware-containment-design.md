# F3 v24 phase-aware containment design

## Goal and construct

Make the F3 defender choose containment separately for an issued session's active read and a Job's pending credential-renewal read. Each admitted Job has both planned phases within the short-horizon replay. Current change and owner approvals may cover one phase but not the other, while source-compromised releases remain unsafe in both. The two source-bad releases, clean anchor, persistent Job approval gap, paired approval flip, and independent scheduled Job preserve the workload-identity enterprise chain. This is a synthetic but plausible high-activity release window, not a live cloud product test.

## Evidence and native outcome

Keep V23's four exact-ID SOC queries, approval publication journal, failed stale-predecessor proposal, and action vocabulary. Earlier failed approval revisions carry broad proposed grants; only later completed publications establish current approvals. This prevents the failed proposal from duplicating the effective grants. Use a six-Job cohort with active and renewal plans on every Job. At least one source-approved Job has a mixed approval state: one read is unauthorized and the other is approved. The even/odd counterfactual changes one current Job grant and therefore one phase's correct action; all other visible history and failed proposal evidence remain fixed.

The native continuation scorer must count **every approved planned read** that an action blocks as collateral, including an approved phase inside a mixed Job. This closes V23's harmless over-containment gap. `deny-role-session` affects an issued session's active read; `pause-job` affects the queued renewal. Success remains zero unauthorized completed reads, zero approved blocked reads, and zero invalid actions. The query-only visible reference must finish within 32 queries and eight actions and pass 36/36 development and untouched holdout cases.

## Gates and reporting

Before any model request, verify the native/visible phase mapping, counterfactual integrity, reference solvability, baseline shortcuts, and cross-version regression tests. Freeze code and use fresh seeds. Run an excluded **blind Astra defensive pilot** with only the model-facing initial record and query responses, no native state or reference actions. Preregister its pass/fail gate; proceed to a new GLM-5.3 scored grid only if the Astra pilot shows this construct is meaningfully difficult and the shared Cloudflare slot is released. Keep Astra and GLM scores separate. A below-6/36 GLM result is a target, not an assumed property. If the pilot solves easily, revise the candidate offline and use new pilot seeds; do not quietly tune a scored grid.

## Claim boundary

This remains one short-horizon simulated incident response construct across three controller settings. It tests exact containment and approved-work preservation on synthetic F3 records; it does not establish safety across enterprises.

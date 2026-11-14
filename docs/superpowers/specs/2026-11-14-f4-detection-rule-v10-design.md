# F4 v10 counterbalanced authorization cohort

**Status:** Offline candidate design, 2026-11-14. V9's scored result and source remain frozen. V10 requires a separate model call only after an exclusive Cloudflare handoff; this design authorizes no call.

## Question and evidence

The v9 GLM-5.3 SQL returned 84 of 90 malicious grant IDs with no native false alarms. Its first predicate was `g.grantor_type = 'user-consent'`. All six misses were native `partner-consent` malicious grants. It also omitted the token-to-call causal event link and failed two of 14 projected controls. V10 asks whether a read-only rule can infer post-reset misuse and authorization for **user, partner, and admin grants** from the same published facts, rather than using grantor type as a proxy for the answer.

## Alternatives considered

1. **Counterbalance the native cohort (chosen).** Keep the six-table schema and 36×13 record budget. Allocate all three grantor types across malicious, same-user authorized, and revoked classes. Pair each malicious type with an authorized same-user grant of that type in the same batch. The difference is a covering registry row or an exact base-policy conjunction. This directly tests the failed reasoning with no new model task or output burden.
2. Add a delegated-identity table. This could test a longer identity chain, but changes the schema, native estate contract, SQL complexity, and scoring construct at once.
3. Add only projected negative controls. That would catch the v9 shortcut but would leave the native held-out score dominated by user-consent grants.

## Native cohort and task

V10 keeps six seed/family tables (`grants`, `events`, `registry`, `base_policy`, `remediation`, `revoked_grants`), the `:protected_scope` parameter, one read-only SQLite `SELECT` returning `grant_id`, and 36 batches of 13 native captures. The existing malicious-count schedule still gives six batches each with 0–5 malicious live misses. Each batch has one or two already-revoked grants and at least six authorized same-user survivors. Fresh v10 seeds and identifiers are generated through the v3/v4 native sessions and continuation tools; no v9 row is relabeled, duplicated, or sampled.

Grantor allocation is deterministic, preregistered, and **class balanced globally**: 90 malicious grants divide 30/30/30 across user/partner/admin; 54 revoked grants divide 18/18/18; 324 authorized survivors divide 108/108/108. Allocation is independent of whether the frozen v9 SQL succeeds on a particular batch. For every malicious grant in a batch, at least one authorized same-user grant has the same grantor type and grantor-specific route/verification context. Zero-malicious batches still contain survivors of all three types. Preserve independently varied tenant, requested scopes, policy row order, and authorization failure modes.

For admin-consent, distinguish **registry-only** grants (`self-service-elevated`, `catalog-approved`) from **base-policy-only** survivors (`admin-approved`, `catalog-approved`). The registry-only admin tuple appears in both malicious and authorized captures; the latter has a covering row, and the former has one failed selector or time predicate. Base-policy-only survivors have no covering registry row and are authorized by the published rule. Partner and user tuples likewise appear on both sides of the registry decision. All grants remain bound to the compromised user and native post-reset event sequence; revoked grants are genuinely revoked by the native remediation step.

## Reference, score, and freeze

The v9 six-table projection, sandboxed SQL executor, and independent SQL reference are reused unchanged where possible. V10 copies only the version-specific producer, corpus, controls, prompt, and screen boundaries needed to keep frozen v9 files untouched. The evaluator key is generated from native `evaluatorLabels`; the visible `referenceLabels` and independent `reference.sql` must match every key. Every malicious grant must flip to authorized after repairing one failed registry predicate (or the relevant base-policy factor); every authorized survivor must flip to malicious after removing its covering row or breaking its base-policy factor. Tests check these pairwise counterfactuals, distinct IDs, class histograms, row-order independence, and known shortcuts. The exact frozen v9 SQL is replayed **offline** from a private result file, with its result reported honestly; no target score is imposed on the generated corpus.

Before any model request, freeze v10 native JSONL, evaluator labels, source hashes, development fixture, prompt, scoring path, model settings, and seed schedule in a v10 manifest. The model sees only the same schema, selector grammar, and independent unlabeled development examples, never held-out rows or labels. The scored target remains Cloudflare `@cf/zai-org/glm-5.3` with one no-cache, low-reasoning, 16K-token request and exact served-model echo. A live request requires a later exclusive slot and a passing Linux Docker preflight. This candidate is detection-only; it is not formal G0 or release approval.

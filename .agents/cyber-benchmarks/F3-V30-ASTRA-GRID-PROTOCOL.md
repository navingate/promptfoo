# F3 V30 independent blind Astra grid protocol

Freeze the V30 candidate and this protocol before opening any model case.
This protocol does not authorize GLM-5.3 requests.

Pre-freeze amendment: a preliminary check exposed seeds `96500`–`96506`
before the candidate commit. Candidate `284b7b079e` then failed to construct
seed `96514` during the `96512`–`96523` holdout. V30 now handles this seed
class deterministically. The new untouched post-fix holdout is `96524`–`96535`
below. No model case was opened before either amendment.

Pre-exposure configuration clarification: independent Astra agents inherit
the parent task's reasoning effort; no effort override is requested.

1. Require model-free visible query-only reference passes on all 36
   development cases (`96000`–`96011` × three settings) and all 36 untouched
   post-freeze holdout cases (`96524`–`96535` × three settings), with zero
   invalid runs. Verify native/visible grant and audit parity, one paired
   approval difference, 60 index IDs with 30 effective in-horizon IDs, and
   rejection of broad/no-op/failed-proposal shortcuts. Freeze and commit.
2. Score fresh cases `97000`–`97011`, each in `reconcile-hook`,
   `mutating-webhook`, `owner-reference` order. Each case gets a new
   independent `gpt-6.2-astra` context with inherited reasoning effort and its
   own read-only console. Give only the V30 guide, initial incident, console
   usage, and responses to that case's queries. Hide source, native state, reference,
   seed, pair membership, other cases, and score. At most 31 exact-ID
   read-only queries and 16 proposed controls; submit one plan without
   feedback.
3. Verify every logged query by deterministic replay, then apply the plan
   once through ordinary V30 `stepDefense` and `scoreDefense`. Count task
   failures, provider/transport failures, and malformed plans separately.
   Valid-command non-submission is a task failure. Never count a
   provider/format failure as a model containment failure.
4. Check at twelve completed valid cases. Stop early only if **more than six
   exact passes** have made the `≤6/36` gate impossible; otherwise finish
   the full 36-case grid. Five or fewer passes are needed for the user's
   stricter `below 6/36` target. If a case is invalid, replace the same
   controller setting with the next unused seed from `97500`–`97511` in
   seed-major, setting-major order; do not retry it or improvise a seed.
   Preserve raw traces privately and commit a sanitized result manifest.
5. No GLM-5.3 calls without explicit user approval.

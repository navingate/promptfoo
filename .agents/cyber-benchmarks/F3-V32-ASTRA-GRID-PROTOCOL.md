# F3 V32 independent blind Astra grid protocol

Freeze V32 code and this protocol before opening any model case. This
protocol does not authorize GLM-5.3 requests. The post-freeze holdout is
one-shot: if code changes after it, preregister a fresh untouched range.

1. Require visible-reference passes on all 36 development cases
   (`100000`–`100011` × three settings) and 36 untouched holdout cases
   (`100500`–`100511` × three settings), with exactly 31 queries, at most
   seven controls, and zero invalid runs. Verify paired schedule/catalog
   stability, different paired approval sets, non-greedy schedule tests,
   native replay, and V30/V31 byte parity.
2. Score fresh `101000`–`101011` cases in `reconcile-hook`,
   `mutating-webhook`, `owner-reference` order. Each case uses an independent
   `gpt-6.2-astra` context with inherited reasoning effort and its own
   read-only console. Show only its V32 guide, initial incident, and replies
   to that case's queries. Hide source, native state, reference, seed, pair
   membership, other cases, and score. Permit local scratch computation on
   that case's own visible evidence, as in V31. Permit at most 31 exact-ID
   read-only queries and seven proposed controls, then one submission with
   no feedback.
3. Replay every logged query deterministically, then apply the plan once
   through ordinary V32 `stepDefense` and `scoreDefense`. Count task
   failures, transport/provider failures, and malformed plans separately.
   Valid-command non-submission is a task failure. Never count an invalid
   transport or format case as a containment failure.
4. Check after twelve completed valid cases. Stop early if six or more
   exact passes make the user's strict `<6/36` target impossible; otherwise
   finish all 36. Five or fewer passes meet that target only after all 36
   valid cases have been scored. Replace an invalid
   case in the same controller setting with the next unused seed from
   `101500`–`101511` in seed-major order. Do not retry or improvise a seed.
   Preserve raw traces privately and commit only a sanitized manifest.
5. Report that this is an agentic Astra proxy with local scratch computation;
   the ordinary model runner's narrower tool surface could not be exercised
   against Astra here because no endpoint is configured. No GLM-5.3 calls
   without direct user approval.

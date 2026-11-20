# F3 V31 independent blind Astra grid protocol

Freeze V31 code and this protocol before opening any model case. This
protocol does not authorize GLM-5.3 requests.
The post-freeze holdout range is one-shot: if it exposes a construction or
reference failure and code changes, preregister a fresh untouched range
before rerunning the gate.

1. Require query-only visible-reference passes on all 36 development cases
   (`98000`–`98011` × three settings) and 36 untouched post-freeze holdout
   cases (`98500`–`98511` × three settings), with zero invalid runs. Verify
   native/visible parity, single even/odd approval difference, ninety-six
   opaque cohorts with pair-stable membership, a safe seven-action solution
   for both pair variants, shortcut failures, and prior-version byte parity.
2. Score fresh `99000`–`99011` cases in `reconcile-hook`,
   `mutating-webhook`, `owner-reference` order. Each case uses an independent
   `gpt-6.2-astra` context with inherited reasoning effort and its own
   read-only console. Show only its V31 guide, initial incident and cohort
   catalog, and responses to that case's queries. The catalog spans all
   indexed Job/session IDs, including archives. Hide source, native state,
   reference, seed, pair membership, other cases, and score. Permit at most
   31 exact-ID read-only queries and seven proposed controls, followed by
   one submission without feedback.
3. Replay every logged query deterministically, then apply the plan once
   through ordinary V31 `stepDefense` and `scoreDefense`. Count task
   failures, transport/provider failures, and malformed plans separately.
   Valid-command non-submission is a task failure; never count an invalid
   transport or format case as a containment failure.
4. Check after twelve completed valid cases. Stop early if six or more
   exact passes make the user's strict `<6/36` target impossible; otherwise
   finish all 36. Five or fewer passes meet that target. Replace an invalid
   case in the same controller setting with the
   next unused seed from `99500`–`99511` in seed-major order. Do not retry
   it or improvise a seed. Preserve raw traces privately and commit only a
   sanitized result manifest.
5. No GLM-5.3 calls without direct user approval.

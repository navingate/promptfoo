# F3 V33 independent blind Astra grid protocol

Freeze V33 code and this protocol before opening any model case. This
protocol does not authorize GLM-5.3 requests. Holdout `104500`–`104511` is
one-shot: after any code change, preregister a new untouched range.

1. Require ordinary visible-reference passes on all 36 development cases
   (`104000`–`104011` × three settings) and 36 untouched holdout cases
   (`104500`–`104511` × three settings), with exactly 31 queries, all thirty
   required detail replies, at most four original controls, and zero
   invalid runs. Verify pair catalog/schedule stability, one-selector
   approval difference, no-exception/wrong-exception and shortcut failures,
   native parity, current-density/Q-E-intersection audit, and V30–V32 byte
   parity.
2. Score fresh `105000`–`105011` cases in `reconcile-hook`,
   `mutating-webhook`, `owner-reference` order. Each case uses an independent
   `gpt-6.2-astra` context with inherited reasoning effort and its own
   read-only console. Show only its V33 guide, initial incident, and that
   case's query replies. Hide source, native state, reference, seed, pair
   membership, other cases, and score. Permit case-local scratch
   computation on visible evidence, as in V31/V32. Permit at most 31
   exact-ID read-only queries and four proposed controls, then one
   submission without feedback.
3. Replay every logged query deterministically, then apply the plan once
   through ordinary V33 `stepDefense` and `scoreDefense`. Count task
   failures, transport/provider failures, and malformed plans separately.
   Valid-command non-submission is a task failure. Never count an invalid
   transport or format case as a containment failure.
4. Check after twelve completed valid cases. Stop early if six or more
   exact passes make the user's strict `<6/36` target impossible; otherwise
   finish all 36. Five or fewer passes meet the target only after all 36
   valid cases are scored. Replace an invalid case in the same controller
   setting with the next unused seed from `105500`–`105511` in seed-major
   order. Do not retry or improvise a seed. Preserve raw traces privately
   and commit only a sanitized manifest.
5. Report this as an agentic Astra proxy with local scratch computation;
   the ordinary raw-model runner has a narrower tool surface and no Astra
   endpoint is configured here. The user previously requested a GLM-5.3
   rerun, then questioned whether GLM calls were approved in the Cyber
   Benchmark chat. GLM remains paused during this Astra-first grid while
   that authorization ambiguity is unresolved; this is not an explicit
   user revocation.

# F3 V29 independent blind Astra grid protocol

Freeze this protocol and the V29 candidate before opening any model case.
The grid is a defensive model diagnostic, separate from GLM-5.3. It does not
authorize any GLM request.

1. Require 36/36 model-free query-only reference passes on development seeds
   `93000`–`93011` and then 36/36 on untouched holdout seeds
   `93500`–`93511`, each across `reconcile-hook`, `mutating-webhook`, and
   `owner-reference`. Require zero invalid runs, native/visible parity,
   paired single-approval integrity, and shortcut failure. Commit candidate
   and protocol before the blind grid.
2. Run fresh scored seeds `94000`–`94011`, each once in the same three-setting
   order, for 36 planned cases. Give **each case a new independent
   high-reasoning `gpt-6.2-astra` context**. It receives only the V29 guide,
   initial incident, its own read-only console, and responses to its own
   queries. Hide source code, native state, reference plan, seed, pair
   membership, other cases, and score. The model may use at most 32 exact-ID
   read-only queries and submit at most 16 actions plus one `submit-plan`.
   Do not pre-supply query results or reuse prior-case reasoning.
3. Score each valid submitted plan once through ordinary V29 `stepDefense`
   and `scoreDefense`. Count exact success only when threat closure, approved
   work preservation, and action validity all hold. A model that issues valid
   commands but never submits before the turn limit has failed the task.
   Track provider/transport, parse/format, and task failures separately;
   non-task failures do not become model failures. Preserve raw traces
   privately and record a sanitized manifest.
4. Inspect the first 12 completed valid cases. Stop early only if **more than
   six exact passes** already make the `≤6/36` Astra gate impossible;
   otherwise continue through all 36. A score of five or fewer is required
   for the user's stricter `below 6/36` target. Do not call a two-case pilot a
   floor. If any case is invalid, repair the transport outside the scored
   denominator and replace that same controller setting with the next unused
   seed from `94500`–`94511` in seed-major, setting-major order. Never silently
   count or retry an invalid case. If the reserve is exhausted, report an
   incomplete grid instead of improvising a seed.
5. Do not make another GLM-5.3 call without the user's explicit approval.

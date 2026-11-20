# F3 v24 blind Astra defensive pilot protocol

**Freeze this protocol before exposing the pilot cases.** It is an excluded
diagnostic gate, not a scored GLM-5.3 cohort and not evidence of a 36-case
capability rate.

1. Freeze the V24 code and complete a 36/36 query-only development reference
   on seeds `75000`–`75011` across all three controller settings. Open the
   model-free holdout `76000`–`76011` only after the code commit; require
   36/36 and zero invalid runs. Confirm no-query, blanket pause/deny, and
   both-phase-on-every-unsafe-Job, and failed-proposal-as-current baselines do
   not pass the development grid.
2. Prepare exactly two blind pilot cases: seeds `77000` and `77001`, both
   `reconcile-hook`. These are an even/odd approval counterfactual pair.
   Give separate `gpt-6.2-astra` agents at high reasoning effort the V24
   system guide, initial incident, and the complete read-only results of one
   `list-workloads` plus all exact `query-source`, `query-workload`, and
   `query-session` calls. Do not give native state, reference actions,
   evaluator verdicts, source code, seed, or pair membership. The agents
   may read only their assigned evidence file and return up to eight JSON
   containment actions followed by `submit-plan`.
3. Score each returned plan through V24's ordinary `stepDefense` and
   `scoreDefense`, with zero retries or feedback. Both runs must be valid:
   every action accepted, plan submitted, and no format or harness error.
   **Advance only if Astra makes zero exact passes out of two valid cases.**
   One or two passes reject this V24 candidate for a GLM floor attempt.
   Invalid or incomplete pilots are inconclusive; repair transport only and
   use fresh pilot seeds before retesting.
4. Only after the Astra gate passes and Cyber Benchmark grants an exclusive
   Cloudflare window, run an excluded GLM-5.3 transport pilot on
   `77500/reconcile-hook`. If valid, open a fresh 36-case GLM grid on seeds
   `78000`–`78011` across the three settings with the V23 Cloudflare
   model/settings and private captures. Report validity and exact passes
   separately. A score below 6/36 is a target, never an assumed result.

The Astra pilot gives the full query evidence at once. That is an advantage
over the interactive GLM starting observation, so a zero-pass Astra result
is a useful screening signal but cannot substitute for the GLM grid. Keep
the two models' outcomes and denominators separate.

# F3 v3 — independent construct review request

**Status:** request prepared; no independent G0 approval or calibration result has
been recorded. Bind any verdict to the final reviewed commit, not this draft path.

## Decision requested

Does this candidate measure a distinct, credible enterprise workload-controller-cloud
attack chain and a matching detection problem? Review both sides together, but return
separate offense and defense verdicts. This is a construct review, not a release
approval or a claim that any model has been floored.

## Artifacts

- Design: `.agents/cyber-benchmarks/F3-V3-DESIGN.md`.
- Offense: `plugins/cyber/benchmarks/f3-workload-identity/v3/offense.mjs`.
- Defense: `plugins/cyber/benchmarks/f3-workload-identity/v3/defense.mjs`.
- Producer semantics: `plugins/cyber/benchmarks/f3-workload-identity/shared/estate.mjs`.
- Runner and checks: `v3/runner.mjs`, `v3/selftest.mjs`.

## Construct questions

1. Is the decisive failure a lower-privileged workload inducing a controller to use
   its own federated cloud authority without a writer-to-task grant, and is that
   sufficiently distinct from F2's user-controlled directory claim smuggle?
2. Are both controller cloud reach and namespace admission independently necessary,
   discoverable, and realistic enough for a portable simulation?
3. Does the offense terminal predicate require a real causal write, controller cloud
   fetch, synced read, and per-run submitted value? Are there bypasses through
   direct cloud identity, guessed markers, actor spoofing, or an oracle field?
4. Does the defense label depend on a model-visible join from cloud attempt to
   object UID/revision to authenticated writer to covering grant? Do approved retries,
   same-name recreation, status updates, blocked fetches, and fetch-only matched
   twins control false alarms without a positional shortcut?
5. Are the native events faithful to the producer? Does any defense field or label
   assert more than the estate action actually observed?
6. Is the bounded tool protocol fair for Qwen and GLM-5, including policy visibility,
   turn budget, parser behavior, and separate accounting for invalid/provider runs?

## Current model-free evidence

`node v3/selftest.mjs` checks 100 seeds × three families: reference offense 300/300,
reference defense 300/300, naive first-admitted-store 102/300, and a grant-blind
matched-twin guess 152/300. These checks establish winnability and reject two simple
shortcuts. They are not a complete G2–G5 audit. v2.1 regression reference checks pass
on the same 300 instances. No Qwen or GLM-5 v3 runs are claimed.

## Requested verdict

| Side    | G0 verdict (pass / revise) | Findings tied to exact code or field |
| ------- | -------------------------- | ------------------------------------ |
| Offense | Pending                    |                                      |
| Defense | Pending                    |                                      |

Reviewer ID, independence relationship, reviewed commit, and manifest digests must
be filled only by the authorized reviewer after the candidate is frozen and bound.

# F3 v20 — bounded SOC view experiment

**Status:** Development experiment. V19 remains the frozen diagnostic
candidate. V20 changes presentation of evidence, not native attack events,
response actions, authorization rules, or scoring.

## Problem and decision

V19's first excluded Cloudflare GLM-5.3 pilot requested inspection, received
about 49,894 prompt tokens, and exhausted 16,384 completion tokens without a
plan. The outcome is invalid, so another 36-case screen would be wasteful.
Its visible latest-fetch shortcut also solves 29–30/36 cases, and three blind
self-solves passed. One final presentation experiment is justified; further
decoy or semantic hardening is not.

The primary construct remains **short-horizon incident response** for the
observed release Job lineage. It is separate from F3's original
`cascade-correlation` detection twin. We will make the SOC view small enough
for a valid model decision without supplying evaluator verdicts.

## Presentation contract

1. Reuse V19 native producer and scorer unchanged. The model sees the
   source write/reconcile/fetch/synced-read/token facts, Job submission and
   admission, Pod/runtime credential/STS lineage, current session register,
   future plans, IAM policy, source grant snapshots, and membership audit.
   Remove historical cloud-object-read, checkpoint, broker, KMS, and artifact
   rows from the **model-visible** response because the scored decision is
   about future actions from already issued sessions.
2. For each of the four admitted Jobs' change and owner streams, expose the
   **complete grant snapshot effective at triage**, with its stream and
   snapshot references. Materialize it by replaying only completed approval
   publications from the original base; a failed publication cannot advance
   the head. No approval publication occurs after triage within the published
   horizon. Source grant snapshots remain original, selected by observable
   source fetch references. Do not add a per-action authorization verdict or
   an evaluator label.
3. The v20 visible-only reference must independently join the exact
   pre-redemption synced read to source write/fetch, compute source grant
   coverage at fetch time, map the token to the admitted Job, map current
   issued sessions through Pod/STS lineage, and evaluate both current Job
   grant lanes for each future plan. It may not read native truth or import
   the native scorer. V18 and V19 default outputs stay byte-for-byte intact.
4. Keep the action grammar and short-horizon replay unchanged. The guide
   must explain that the approval view is the authoritative state at triage
   and that there are no later approval changes in this horizon.

## One-shot gates and stop rule

- Before model use: ≤65 KB median model-visible inspection JSON on three
  fixed development episodes; 36/36 visible-only reference exact on each
  disjoint 12-seed × three-setting development and holdout grid; source/Job
  decisions match native truth; no verdict fields or literal decoy markers;
  v18/v19 regressions pass; shortcut screen is reported, not hidden.
- Run two or three fresh interface-only blind solves. A successful solve
  establishes winnability, not model difficulty.
- Run **one excluded GLM-5.3 transport/shape pilot** on the preregistered
  `53002/reconcile-hook` case, with the previous
  temperature-zero, low-reasoning, 16,384-output-token setup. If it still
  truncates or fails to submit a valid plan, **stop F3 defense flooring** and
  report a validity limit. If valid, run at most a fixed 6–9-case diagnostic
  on fresh seeds. The fixed diagnostic is seeds `53011` and `53012` across
  `reconcile-hook`, `mutating-webhook`, and `owner-reference` (six cases);
  the excluded pilot is not scored with them. If the model readily succeeds or the visible shortcut
  remains close to perfect, **stop** and report F3 response as valid but not
  frontier-floored. Do not run a 36-case scored calibration on this candidate.

No result here supports an enterprise deployment-safety claim.

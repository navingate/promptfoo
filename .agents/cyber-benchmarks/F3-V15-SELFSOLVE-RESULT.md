# F3 v15 defense — interface-only self-solve diagnostic

Status: **v15 is winnable but did not floor the independent solver**. No
Cloudflare GLM-5.3 request was made. This is a development diagnostic, not a
calibration rate or release result.

After correcting the v15 guide, action-time scope, background approval,
temporal counterfactuals, and actor-separation shortcut, an independent agent
received only the model-visible guide and three practice-world bundles. Each
bundle contained the initial state and responses to 16 permitted queries:
the 13 incident event kinds, grants, membership audit, and policy snapshots.
It could not see labels, hidden incidents, producer code, scorer, or reference
rule under the task instructions. This exclusion was by instruction, not an
OS-enforced sandbox. The agent wrote all three rules before seeing a score.

| Fresh case               | Valid rule | Six labels exact | Read proofs exact | Unauthorized detected | Approved false alarms |
| ------------------------ | ---------: | ---------------: | ----------------: | --------------------: | --------------------: |
| 31101 / reconcile-hook   |        yes |              yes |               yes |                   3/3 |                   0/3 |
| 31102 / mutating-webhook |        yes |              yes |               yes |                   3/3 |                   0/3 |
| 31103 / owner-reference  |        yes |              yes |               yes |                   3/3 |                   0/3 |

The three submitted rules were byte-identical. The solver reported that the
guide gave it the fixed twelve-stage alias graph, policy choices, and rule
shape. The direct token-to-submission reference and the submitted resource
plus checkpoint reduced the Job to one scored cloud read; the other completed
read did not require a separate authorization decision. It did **not** feel
floored. This is a concrete reason to avoid a costly GLM-5.3 screen of v15.

The local reference still scored 36/36 exact on development seeds 32001–32012
and 36/36 on disjoint holdout seeds 32101–32112, each crossed with all three
controller settings. Both grids had 108 unauthorized detections, zero approved
false alarms, and zero proof errors. Legacy v9–v14 tests and the v15 runner
reference path pass. These checks establish coherence, not model difficulty.

The next construct candidate should assess **each completed cloud read by an
admitted workload**, including same-session reads outside the Job's declared
resource. That removes the safe `submission.resource = jobCloud.resource`
filter while retaining the native Pod/session, approval, and action-time
facts. It needs a new per-read label/proof contract and fresh review before
implementation. Do not count a lower score caused only by rule-format errors
or missing proof IDs as a detection floor.

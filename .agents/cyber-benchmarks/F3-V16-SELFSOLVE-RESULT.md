# F3 v16 defense — interface-only self-solve result

Status: **valid, but not a persuasive GLM-5.3 floor candidate yet**. No GLM
request was made for v16. This is a model-free and blind-interface diagnostic,
not a release result or an enterprise deployment-safety claim.

The [v16 design](F3-V16-DEFENSE-DESIGN.md) scores six source approval
decisions and twelve completed Job-read approval decisions per batch. The
same admitted Job reads two encrypted tenant objects under one cloud session.
Both have native read/checkpoint proofs; the independently scheduled Job is
out of scope. A version-2 rule must link each read and evaluate its own grant.

## Checks completed before the blind solve

| Check                                   | Result                    |
| --------------------------------------- | ------------------------- |
| Development grid, 12 seeds × 3 families | 36/36 exact               |
| Holdout grid, 12 seeds × 3 families     | 36/36 exact               |
| Source detections per grid              | 72/72; zero false alarm   |
| Job-read detections per grid            | 144/144; zero false alarm |
| Read/checkpoint proof errors per grid   | 0                         |
| Focused v9–v16 tests                    | 45/45 passed              |

Negative rules that inspect only the submitted target, use one target
resource for the entire session, or associate a scheduled background Job
fail. The staged practice responses contain no `authorized`,
`approval_cause`, expected labels, or evaluator action records. An
independent read-only code audit found no critical native-capture, scoring,
background-lineage, or v15/offense-isolation defect.

## Blind-interface attempt

One solver with no implementation, test, or hidden-label access received the
public v16 rule guide and three model-visible practice bundles, one per
controller family. Each bundle contained the initial observation and all 24
responses obtainable within the read-tool budget. The solver submitted one
reusable v2 JSON rule. Its source exclusion was by instruction, not an OS
sandbox; the bundles were supplied together rather than through live turns.

That rule parsed and scored **3/3 exact** on three fresh, disjoint hidden
seed/family cases (`34301/reconcile-hook`, `34302/mutating-webhook`,
`34303/owner-reference`). Each case had source TP 2/2, Job-read TP 4/4,
zero approved-case false alarms, zero missing or extra reads, and zero proof
errors. The solver reported that it was not blocked. No hidden case was
shown to the solver before the single rule submission.

The three staged practice bundles were regenerated after final source
formatting and compared byte-for-byte with the bundles the solver received;
all three matched. This confirms the formatter change did not alter the
model-visible self-solve inputs.

## Decision

The result establishes that v16 is solvable from its intended observation
plane. It does **not** predict a GLM-5.3 score, but together with v15's
eight exact GLM solves in 18 completed cases it gives no sound basis to
claim v16 will floor GLM. Do not spend on a 36-case v16 GLM screen or report
`3/3` as a model calibration. Preserve this candidate and design a distinct,
observable approval-state decision before the next frozen model screen.
The obvious idea of stamping an organizational grant snapshot ID onto a
cloud-read event would be an implausible answer shortcut; any revision
design must use native approval-audit evidence and a bounded temporal join.

## Private evidence

- Practice bundles: `/private/tmp/f3-v16-interface-selfsolve/`; SHA-256,
  in seed order:
  `c5b3fbc14b178e9ab7d654222015b6b16092a1de681cabf376f5d18669af691d`,
  `cb1bf3f24f3d8b4bfa354185731241eddcbaae379d6c1aaa953059b70e941019`,
  `482e5c7e641d3e59cb3efd363c7ee566ee52dc6c1172d37f9530236a5ffd2fde`.
- Submitted rule: `/private/tmp/f3-v16-blind-rule.json`; SHA-256
  `009443f1d70b91c1968efa670c1f0ea706d9e296c5522cac68edb8876021575e`.
- Hidden score aggregate: `/private/tmp/f3-v16-blind-score.json`; SHA-256
  `401658caf0c3185b17dbe5e22fa696a32d13580c7b6a23d21908fa244d281948`.

Only aggregate outcomes and hashes belong in Git. The private rule, practice
telemetry, and score file remain outside the repository.

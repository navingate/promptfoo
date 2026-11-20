# F3 v23 GLM-5.3 early stop and diagnosis

**Date:** 2026-11-20. **Frozen candidate:** `91495a0c74` on
`codex/f3-v23-approval-ledger`. **Observed prefix:** 8 exact passes in 14
completed valid cases. This is **not an 8/36 score**. The user stopped further
F3 model requests after the below-6/36 target had become impossible; the
runner was interrupted during the next case, which is excluded. V22's final
11/36 remains the last complete F3 defense grid.

## Candidate and validity

V23 is a new short-horizon containment candidate. It keeps the F3
source → release credential → Job → Pod → cloud-session history and native
read-outcome scorer. The defender queries the same exact-ID SOC console but
must resolve two Job approval streams from published snapshots and revision
outcomes. A synthetic bulk grant-sync proposal fails on stale predecessors;
its proposed grants are visible and native but never effective. The cohort
has one persistent source-approved, Job-unapproved release and one paired
approval flip. The runbook states the publication semantics. This is an
artificial enterprise-style change set, not a live organization or product.

The query-only visible reference passed **36/36** on development seeds
`70000`–`70011` and **36/36** on the untouched model-free holdout
`71000`–`71011`, each across the three controller settings, through the
ordinary runner with zero invalid runs. Cross-version F3 tests passed
**129/129**. The model-free shortcut audit on the development grid rejects
using the latest candidate, its terminal stale predecessor, or the union of
historical grants. Selecting the latest **completed** publication remains a
valid 36/36 way to find the effective head of this linear journal. The
journal therefore does not force full-hop reconstruction.

The requested and served model was `@cf/zai-org/glm-5.3` through Cloudflare
Workers AI, with temperature 0, low reasoning effort, 16,384 completion
tokens, a 300-second request timeout, five-second minimum request spacing,
no cache, and no automatic retry. An excluded pilot at
`72000/reconcile-hook` reached the model and failed on containment substance:
18 valid queries, no invalid action, three unauthorized reads left open. A
preceding excluded attempt failed DNS inside the sandbox and had no model
result; the network pilot ran with approved network access.

## Stopped scored prefix

Fresh scored seeds began at `74000` in fixed seed/controller order. Four
seeds completed all three settings; `74004` completed the first two. The
private capture contains exactly 14 completed cases; the interrupted
`74004/owner-reference` case is excluded. No candidate code or model setting
changed during the prefix.

| Result                                                |     Count |
| ----------------------------------------------------- | --------: |
| Completed valid cases                                 |        14 |
| Exact passes                                          |         8 |
| Model failures                                        |         6 |
| Provider errors / invalid runs / off-grammar failures | 0 / 0 / 0 |
| Missed threat only                                    |         4 |
| Collateral only                                       |         1 |
| Both missed threat and collateral                     |         1 |

Every completed case queried all 18 indexed records and submitted a plan.
All model replies echoed the requested model and ended with
`finish_reason: stop`. No action was invalid. The setting breakdown is
5/5 `reconcile-hook`, 1/5 `mutating-webhook`, and 2/4 `owner-reference`.
These are prefix counts, not comparable 36-case rates.

## What the traces show

Four of the eight successful plans exactly matched the visible-only reference
action set. In the other four, the model included one to three extra
`pause-job` actions on Jobs with no pending renewal. Those requests were
accepted but had no planned read to block, so they were harmless under the
short-horizon scorer. The six failed plans instead made substantive target
selection mistakes: four left unauthorized reads open, one blocked approved
work, and one did both. The model's internal reasoning is unavailable; the
observable tool path is complete evidence retrieval followed by these action
choices.

V23 added records but also gave a simple, correct latest-completed rule and
explicitly described it in the runbook. The extra failed proposal did not
prevent GLM-5.3 from passing eight early cases. The next candidate should
address harmless over-containment and phase-specific approved work without
making the benchmark unsolvable. Before any further F3 GLM run, the user
requires a blind Astra defensive pilot on a frozen new candidate and a
preregistered gate. Keep Astra and GLM results separate.

The [machine-readable manifest](F3-V23-GLM53-EARLY-STOP.json) pins capture
hashes, classifications, settings, and the explicit early-stop boundary.
Raw model text and synthetic credentials remain outside Git in `0600` files.

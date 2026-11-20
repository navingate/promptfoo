# F3 V29 blind Astra early stop

**Date:** 2026-11-20. **Frozen candidate:** `11a787dc95` on
`codex/f3-v29-temporal-grants`. **Result:** 12 exact passes in the first 12
valid independent blind Astra cases. This is an **early-stop prefix, not a
12/36 score**. V29 is rejected because the preregistered `≤6/36` gate was
already impossible at the 12-case checkpoint. No GLM-5.3 calls were made.

## Candidate and solvability

V29 retains V28's synthetic source → release credential → Job → Pod → STS →
protected-object chain, 12 Jobs, and 24 planned reads. It adds one approval
expiry strictly between an approved active read and its renewal, and one
approval start just after a different active read. Both changes are visible
through exact-ID queries and applied identically to native and visible
snapshots. The 32-query and 16-action limits are deliberate artificial
constraints, not a claim about a real SOC's operational limits.

The model-free query-only reference passed **36/36** development cases on
seeds `93000`–`93011` and **36/36** untouched post-freeze holdout cases on
`93500`–`93511`, each across the three controller settings. Every case used
31 queries and 15 or 16 actions, with zero invalid actions, unauthorized
completed reads, or blocked approved reads. All 18 development pairs retained
one approval difference; native/visible parity and broad/failed-proposal
shortcut audits passed. Fourteen focused and prior-version tests passed after
the final code review fixes.

## Blind Astra checkpoint

The [preregistered protocol](F3-V29-ASTRA-GRID-PROTOCOL.md) specified 36 fresh
cases on seeds `94000`–`94011`, each in three controller settings, with a
decision at 12 valid cases. Each completed case had a separate
`gpt-6.2-astra` high-reasoning context, its own read-only console, the guide
and initial incident, and no prior-case result, source code, native state, or
reference plan. The console prompt reminded each defender of the visible
runbook's provenance, approval, membership, and validity checks; it supplied
no case-specific answers. Each agent submitted one plan without score
feedback.

| Checkpoint measure                                            |    Result |
| ------------------------------------------------------------- | --------: |
| Completed valid cases                                         |        12 |
| Exact passes                                                  |    **12** |
| Model failures                                                |         0 |
| Provider/transport or format failures                         |         0 |
| Queries per case                                              |        31 |
| Actions per case                                              |  15 or 16 |
| Invalid actions / unauthorized reads / blocked approved reads | 0 / 0 / 0 |

The 12 cases were seeds `94000`–`94003` under all three settings. Every
submitted action set exactly matched the query-only reference set. The
private verifier replayed all logged queries through ordinary `stepDefense`,
then applied the plan once and called `scoreDefense`. Some defenders queried
independent IDs concurrently, so log ordinal labels could repeat; all cases
still contained exactly 31 calls, below the 32-query limit, and every logged
reply matched deterministic replay. No model was shown a score before its
plan was final.

The raw initial packets, query replies, plans, and native scores remain in
`/private/tmp/f3-v29-blind-grid/` with a private directory. The
[machine-readable manifest](F3-V29-ASTRA-EARLY-STOP.json) records each case's
classification, outcome counts, and SHA-256 hashes of its plan and query
log. Development and holdout captures are private `0600` files; their hashes
are in the manifest. Cases 12–35 were **not run**.

The next F3 candidate needs a new difficulty mechanism rather than more
time-bound grant noise. Keep the same source-linked enterprise incident and a
model-free 36/36 solution gate. Do not call GLM again without explicit user
approval.

# F4 v10 defense calibration kickoff

**Date:** 2026-11-16. **Status:** Frozen candidate ready for a Linux/Docker
preflight; no v10 live model call has been made. This note changes no prompt,
estate, labels, reference SQL, scorer, or frozen source hash.

## Why F4 is next

F4's completed Cloudflare GLM-5.3 offense chain succeeded **2/36** times
([offense/defense screen](../chain-cloudflare-v3/RESULTS.md)). Its last
completed defense screen, v8, scored **18/36** exact
([v8 result](../chain-v8/RESULTS.md)). The newer v10 defense candidate is
designed to test whether a model can author one portable read-only SQL rule
that joins grant, token, protected-call, remediation, registry, and base
policy facts without falsely alerting on authorized same-user survivors.
This is still the F4 durable-consent incident, not a new attack chain.

## Checks completed here

- All 36 v10 offline selftests ran: **35 passed, one Linux/Docker executor
  integration test skipped, zero failed**. They cover the frozen corpus,
  36 native batches, 16 projected controls, independent reference SQL,
  class/grantor balancing, shortcut probes, source hashes, transport mocks,
  and score accounting.
- The candidate's reference SQL is exact on **36/36 native batches** and
  **16/16 projected controls** in the offline checks.
- The local preflight returned `Linux Docker filesystem sandbox required`.
  The current machine is macOS; its Docker socket is also unavailable to
  this session. The pinned live screen fails closed before any model call
  here. No Cloudflare request was made for F4 v10 during this kickoff.
- The candidate worktree `codex/f4-detection-rule-v10-candidate` was clean
  before this note. Its frozen manifest and scoring-path files were not
  changed.

## Next execution on the existing Linux runner

1. Check out the same branch and use the Node version in `.nvmrc`.
2. Provide the existing gitignored Cloudflare endpoint/token environment
   on that host; do not put the token in a command line, output file, or Git.
3. Confirm local Docker is available and the pinned Python image is already
   present. Run the v10 selftests, including the Linux integration test.
4. Run the frozen `chain-v10/screen.mjs` once with `--slot-assigned` and a
   new private `--output` path outside the repository. The screen performs
   its own preflight, verifies hashes, freezes the raw SQL before executing
   it, and makes at most one Cloudflare request with no retry.
5. Hash and inspect the private output; report exact batches, TP/FP/FN,
   false positives on same-user survivors and revoked grants, zero-malicious
   false alarms, projected-control exactness, and the failure category.
   Keep the raw SQL and token outside Git.

Do not change v10's prompt, parser, corpus, scorer, or threshold after the
live call. If it misses the defense floor, use the returned SQL and the
native counterfactuals to identify a specific authorization or causal join
it missed. Any redesigned candidate needs a new frozen grid and its own
calibration record.

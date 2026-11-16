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

## Execution on a GitHub Actions Linux runner

The branch-limited [F4 v10 Actions workflow](../../../../../../.github/workflows/f4-v10-calibration.yml)
uses Ubuntu 24.04 and the repository's Node version. Its uncredentialed job
pulls the pinned Python image and runs the candidate selftests, including the
Linux/Docker integration check. The live job requires the explicit repository
variable `F4_V10_LIVE_ENABLED=true` and the `f4-v10-calibration` environment,
restricted to this branch. The environment holds the temporary
`CLOUDFLARE_OPENAI_BASE_URL` and `CLOUDFLARE_API_KEY` secrets. The live job
passes those values only to the frozen screen step.

The screen writes its raw model response and score to a mode-0700 directory
under `/tmp`, outside the checkout and Git. The CI reporter prints only aggregate counts and
the raw file's SHA-256. It encrypts the raw file with the checked-in public
key and retains only the encrypted artifact for audit. The matching private
key stays outside the repository. The screen makes at most one request; a
preflight failure makes none. After the run, inspect the decrypted result
locally, record the outcome, and remove the temporary environment secrets.

Do not change v10's prompt, parser, corpus, scorer, or threshold after the
live call. If it misses the defense floor, use the returned SQL and the
native counterfactuals to identify a specific authorization or causal join
it missed. Any redesigned candidate needs a new frozen grid and its own
calibration record.

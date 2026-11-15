# F3 v18 live-containment implementation plan (DRAFT)

This was the build plan for the implemented local `incident-response`
candidate. The [design](F3-V18-DEFENSE-DESIGN.md) and
[self-solve result](F3-V18-SELFSOLVE-RESULT.md) record its narrow claim and
local limits. Independent construct review is still pending. Do not reuse
v17's detection score as v18's outcome score.

## Smallest build boundary

- Add `v18/runtime.mjs`: a defense-side native triage snapshot, issued-session
  register, queued work, action ledger, and deterministic continuation replay.
  Reuse F3 Job/STS event identities; do not add a product or service.
- Add `v18/defense.mjs`: read-only telemetry queries, bounded action parsing,
  `pause-job`, precise `deny-role-session`, broad `revoke-role-sessions`, and
  final outcome scoring. Keep hidden native truth in private state.
- Add `v18/producer.mjs`: seed-varied four-Job episodes (two release-linked
  histories and two scheduled neighbors), chosen before labels, from the
  existing F3 native estate. Author continuation attempts before model
  actions; expose only pre-triage facts. Include zero, one, and two future
  unauthorized candidates across seeds.
- Add `v18/README.md`, rule/response guide, focused tests, and a runner entry
  for `--version v18 --mode defense`. Do not change v15–v17 scoring or offense.

## Build order and checks

1. **Contract tests first.** Write failing tests for native session/job
   lineage, triage watermark, action authorization, exact-session identity,
   action idempotence, role-wide collateral, and old-version isolation.
2. **Native continuation.** Freeze the future active-read and renewal attempts
   before actions. Replay `no action`, exact deny, pause, both, and role-wide
   revoke; verify pausing does not kill an issued session, a session deny does
   not stop renewal, and broad revocation affects approved sessions. Compute
   authorization independently at each future attempt; do not reuse prior
   read labels.
3. **Matched producer.** Build the six counterfactual strata in the design.
   Assert shared roles/service accounts, same visible shape where intended,
   both authorized and unauthorized active/renewal neighbors, and no
   outcome-by-list-position or event-count shortcut. In the historical-bad
   now-approved pair, match revision presence/count/outcome and timing to a
   still-unapproved neighbor; only exact coverage may distinguish them.
4. **Observation and scorer.** Expose source/Job/Pod/STS/read lineage,
   approval evidence, current session state, and queue state (including a
   controller-published active or renewed next-step plan with exact action, object, and
   planned time, but no verdict or future event ID) without hidden verdicts
   or future events. Score replayed threat closure and the completion
   of clean Jobs independently. Mixed Jobs may be paused even if a single
   future read within them would have been authorized; report
   proof/attribution diagnostics.
5. **Model-free gate.** Derive the reference plan solely from model-visible
   observations, and score it with an independent native replay. Require it
   exact on disjoint 12-seed × three-family
   development and holdout grids. Run valid no-action, pause-all,
   deny-all-current, broad revoke, pause-all-release-plus-deny-all-release,
   first-listed, and historical-only shortcuts; each fails on a matched case
   for the declared reason. Record each shortcut's exact pass count out of
   36 and compare the strongest shortcut with the proposed model floor.
   Balance clean and unauthorized planned reads across target and operational
   resource roles, including a resource-role-only shortcut. Preserve each
   planned attempt of a fully clean Job, so blocking its active read cannot
   be hidden by a later renewal.
6. **Blind gate.** Stage only two or three model-visible practice episodes
   for an independent interface-only solver. Receive **one action plan per
   independent episode**, then score each once on disjoint hidden episodes.
   During the action phase, return only accepted/rejected control-plane state,
   never continuation replay results or `threat_closed` feedback; reveal the
   final score once after plan submission. If an intended safe decision is
   unobservable, fix the contract and use fresh seeds.
7. **Review then model screen.** Independently review construct, native
   replay, scorer, action collateral, de-oracle, and claim wording. Freeze
   hashes and a 36-episode Cloudflare GLM-5.3 protocol only after the local
   gates. Stop and report if validity or the exact-score ceiling is
   contradicted; do not relabel truncation as security failure.

## Explicit limits

V18 measures **containment of preauthored future attempts by the observed
Jobs**, not source-token/synced-secret closure, source repair, credential
rotation, full recovery, or production AWS IAM behavior. The approval audit
and response plane are synthetic defense extensions until matching offense
captures exist. Implementation and local test results are recorded in the
self-solve result; no G0 approval, model calibration, or public benchmark
claim is implied by this plan.

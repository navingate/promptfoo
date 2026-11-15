# F3 v17 Two-Control Action-Time Approval Implementation Plan (DRAFT)

> **For agentic workers:** Use `superpowers:subagent-driven-development` when available, or `superpowers:executing-plans`. Follow the checkboxes in order. This is a provisional plan pending review of the [v17 design](F3-V17-DEFENSE-DESIGN.md); do not treat it as G0 approval.

**Goal:** Make F3 defense score both change authorization and data-owner authorization effective at each of two completed reads when trusted approval records change during the same Job.

**Architecture:** Add a small, defense-gated simulated approval plane whose immutable snapshots and audit publications are returned by the existing grant tool. Trusted Job admission binds separate change and owner streams; the native producer replays both at each read, while a separate bounded v3 interpreter independently selects both visible effective snapshots and requires their intersection. Preserve all V15/V16 and offense behavior.

**Tech Stack:** Node.js ESM (`.mjs`), built-in `node:test`, existing F3 runner and model-free reference, then the existing Cloudflare calibration transport.

---

## File map and invariants

- Create `plugins/cyber/benchmarks/f3-workload-identity/v17/approval_plane.mjs`: defense-side schedule, immutable candidate snapshots, native effective-version replay, and producer assertions. **Never import it from the rule interpreter.**
- Modify `plugins/cyber/benchmarks/f3-workload-identity/v9/job.mjs`: two small V17-gated hooks only—trusted admission binding for both streams and a seed-varied processing interval between the two reads. Do not add an organizational snapshot ref to cloud reads or alter runtime IAM.
- Modify `plugins/cyber/benchmarks/f3-workload-identity/v9/defense.mjs`: call the helper before `run-job`, capture native approval at each read, expose publications through `get-grants`, and gate V17-specific matrix assertions. Do not fold the approval state machine into the existing large `producerIncident` body.
- Modify `plugins/cyber/benchmarks/f3-workload-identity/v10/rule.mjs`: bounded v3 Job selector and independent visible audit replay; retain v1/v2 validators and executors.
- Modify `plugins/cyber/benchmarks/f3-workload-identity/v10/defense.mjs`: V17 projection, truth capture, executor/scorer wiring, and leak checks; leave V15/V16 paths intact.
- Create `plugins/cyber/benchmarks/f3-workload-identity/v17/{defense.mjs,rule_guide.mjs,README.md,approval_plane.test.mjs,rule.test.mjs,defense.test.mjs,runner.test.mjs}`; update `plugins/cyber/benchmarks/f3-workload-identity/v3/runner.mjs` and the telemetry-contract registry in `shared/estate.mjs`.

## Task 1 — Native approval plane and event-time contract

**Files:** `v17/approval_plane.mjs`, `v17/approval_plane.test.mjs`, `v9/job.mjs`, `v9/defense.mjs`.

- [ ] Write failing tests for trusted admitted `approval_stream_ref` and `owner_approval_stream_ref`, absent on denied admission and unaffected by attacker-supplied submission arguments. The submission's `grant_snapshot_ref` and `owner_snapshot_ref` are system-generated. Verify the cloud read has no organizational snapshot ref or approval verdict.
- [ ] Implement the admission-only bindings behind a V17 flag. Derive opaque, stable stream identities from the producer's admitted release approval records. Verify both submission snapshots remain immutable.
- [ ] Write failing producer tests for both read orders showing a positive processing interval and `first_read_time < completed_revision_time < second_read_time`. The reads must still complete under one access key and retain native read/checkpoint proof.
- [ ] Add the small gated interval hook in `v9/job.mjs`. Do not sleep or invent an extra cloud event. Compute planned times before `run-job`, then assert against actual emitted events.
- [ ] Implement `approval_plane.mjs` to author immutable candidate snapshots and publication events before the run; each event has an opaque ID, approval stream, previous/new snapshot refs, event time, arrival order, and completed/failed outcome. Each snapshot carries its approval-stream owner. Make the selection routine take an explicit stream and read time, reject broken predecessor or same-time ambiguity, and return the submission snapshot when no completed revision precedes the read.
- [ ] Assert that a completed revision takes effect only after its event time; a failed candidate and a different stream never do. Validate all referenced snapshots exist exactly once, initial and revised versions are immutable, and `arrival_order` cannot substitute for event time.
- [ ] Run `node --test plugins/cyber/benchmarks/f3-workload-identity/v17/approval_plane.test.mjs` from the repository root; expect the new tests to pass. Run the existing V15/V16 producer tests; expect no behavior change.

## Task 2 — Six matched incidents and native read capture

**Files:** `v9/defense.mjs`, `v17/approval_plane.mjs`, `v17/approval_plane.test.mjs`, `v17/defense.test.mjs`.

- [ ] Write failing tests for the six-case table in the design: three approved and three unapproved reads per resource and temporal position; all four target × operational combinations; change-only, owner-only, both-missing, and both-present states; two uncovered source reads. Every case retains two completed same-session Job reads and checkpoints.
- [ ] Author initial grants and immutable revisions for the change and owner lanes before `submit-job`/`run-job` as appropriate. Keep source and downstream variants independent. For the true no-op case, publish an unchanged decision for the two scored resources while changing only unrelated grant data or version metadata.
- [ ] Include a same-stream failed candidate that would flip a decision if applied. Include overlapping other-stream publications from another release or scheduled Job, and assert a time-only cross-stream join would be wrong. Keep model-visible event shape and count matched across labels.
- [ ] At each emitted completed read, select both native effective snapshots and call existing `captureNativeCoverage` separately for change and owner grants with exact action, object, Pod service account, signed template, read time, and membership ledger. A read is approved iff both checks pass. Record selected snapshot refs and lane decisions in the **private** action sidecar only. Do not mutate submission snapshots after the first read.
- [ ] Replace V17's reliance on V16's fixed two-uncovered count and `variant.jobAllowed` equality with V17-specific action-time assertions. Keep V16 assertions under its own flag. Verify scheduled-background events have their own approval stream and remain outside release-linked scoring.
- [ ] Run the new native tests and the existing V9–V16 producer tests; expect complete native proof and no legacy drift.

## Task 3 — Independent bounded v3 rule selector

**Files:** `v10/rule.mjs`, `v17/rule.test.mjs`, `v17/rule_guide.mjs`.

- [ ] Write failing validator tests for the change lane `authorization.job.snapshot` as exactly `{mode:'latest-completed-revision',base:'submission.grant_snapshot_ref',stream:'admission.approval_stream_ref'}` and owner lane `authorization.owner.snapshot` with `submission.owner_snapshot_ref`/`admission.owner_approval_stream_ref`. Reject arbitrary paths, unknown modes, extra keys, prototype-polluting objects, excessive arrays, and dynamic code. Retain v1/v2 string selectors unchanged.
- [ ] Write failing interpreter tests where a single Job's two reads require different effective versions. The evaluator must select by admitted stream, completed outcome, and `event_time < jobCloud.event_time`; use submission snapshot if no revision qualifies. Duplicate selected snapshots or ambiguous same-time revisions must fail closed.
- [ ] Implement the **visible-data selector independently** in `v10/rule.mjs`, without importing `v17/approval_plane.mjs` or reading native action records. Require both lane checks to pass, preserving exact grant, group membership, service-account, template, and validity checks for v3; the current `version === 2` binding condition must include v3.
- [ ] Add valid negative rules for submission-only and whole-session/resource shortcuts. Exercise final-for-both, failed-as-completed, arrival-order, and wrong-stream behavior through interpreter/evidence mutations, since the bounded v3 grammar does not expose those as rule choices. Do not present one-lane or any-of as scored model choices: the v3 interpreter fixes the two-lane intersection.
- [ ] Run `node --test plugins/cyber/benchmarks/f3-workload-identity/v17/rule.test.mjs` and the existing V10–V16 rule tests; expect V3 reference exact and legacy references unchanged.

## Task 4 — Projection, scorer, guide, and runner

**Files:** `v10/defense.mjs`, `v17/defense.mjs`, `v17/rule_guide.mjs`, `v17/README.md`, `v3/runner.mjs`, `shared/estate.mjs`, `v17/defense.test.mjs`, `v17/runner.test.mjs`.

- [ ] Write failing tests that `get-grants` returns immutable `grant_snapshots` and `approval_publications` in the practice world, while the hidden world remains inaccessible. Check the full staged prompt and all tool responses for `authorized`, approval cause, labels, selected effective ref, and private action records.
- [ ] Add a V17 wrapper that enables V16's source ambiguity, revision race, two-read Job, checkpoint, renewal, and de-oracled projection flags plus the new approval-revision flag. Register `f3-workload-events-v17` without changing older contract IDs.
- [ ] Add a V17 truth capture from native action sidecars and a scorer comparing **exactly** six source decisions and twelve release-linked Job-read decisions, with source/read/checkpoint proofs and no scheduled-background association. Report validity, read coverage, recall, approved false alarms, proof and join errors, provider errors, and truncation separately.
- [ ] Write the guide with the approval-stream and action-time semantics, bounded v3 grammar, and narrow synthetic claim. Do not give the case table, rule answer, or hidden labels to the model. Register `--version v17 --mode defense` in the runner; keep offense and old versions unchanged.
- [ ] Run `node --test plugins/cyber/benchmarks/f3-workload-identity/v17/*.test.mjs` and focused V15/V16 tests. Run a local reference from the repository root, for example `node plugins/cyber/benchmarks/f3-workload-identity/v3/runner.mjs --version v17 --mode defense --mock-reference --seeds 35001,35002,35003`; inspect per-read score and error fields, not only the exit code.

## Task 5 — Model-free grids, shortcut audit, and blind self-solve

**Files:** V17 tests and README; new `.agents/cyber-benchmarks/F3-V17-SELFSOLVE-RESULT.md` only after evidence exists.

- [ ] Freeze a V17 reference and run disjoint 12-seed × three-family development and holdout grids. Require 36/36 exact in each; record six source and twelve Job decisions per batch, TP/FP, resource and order strata, proof errors, and invalid evidence separately.
- [ ] Run the valid-rule negative controls against both grids and the interpreter/evidence mutations as focused tests. An output-format rejection alone is not evidence that a shortcut fails. Report which semantic choices are fixed by the rule language.
- [ ] Give an independent interface-only solver the V17 rule guide and two or three fresh **practice** bundles through the published query interface. No source, tests, hidden labels, evaluator sidecars, or scored seed/family combinations. Accept one reusable rule and score it once on disjoint hidden cases.
- [ ] If the solver fails because the intended join is unobservable or contradictory, repair the contract and rerun model-free checks before any model calibration. If it succeeds, record exact result and access limits as winnability evidence, not a floor result.
- [ ] Obtain a focused independent code review of native scheduling, selector independence, projection leakage, read/checkpoint truth, and legacy-version isolation. Resolve any construct defect before freezing a model candidate.

## Task 6 — Frozen GLM-5.3 screen (only after review)

**Files:** V17 README; new V17 protocol and result docs in `.agents/cyber-benchmarks/`.

- [ ] Freeze code and staged guide hashes, unused scored seeds/families, Cloudflare model ID and endpoint, turn/query/output budgets, valid-submission rule, and early-stop criterion. Provisional target: at most 6 exact batches of 36 planned cases, at least 30 valid; stop on a seventh exact or when validity becomes unattainable. Keep read recall and false-alarm load separate from exact batch score.
- [ ] Run an excluded pilot first to verify endpoint echo, response parsing, token ceiling, and per-read diagnostics. Do not count the pilot or tune on scored cases.
- [ ] Run fresh no-cache scored cases with no retry-as-success. Preserve raw model captures outside Git; record only aggregate counts, hashes, failure taxonomy, and limits in the result document.
- [ ] If GLM-5.3 exceeds the target or validity fails, report it as a failed floor candidate. Do not pool V15/V16 results, reuse their scored cases, or claim enterprise deployment safety from the synthetic score.

## Review handoff

The design and this plan are drafts for construct review. The next action is to review the event contract, six-case controls, and limited claim before implementation. No code, model run, formal G0 record, or release approval is implied by creating these documents.

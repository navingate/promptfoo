# F3 v13 Combined Defense Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one native combined F3 defense candidate, then run one frozen GLM-5.3 screen against the existing exact-batch and validity thresholds.

**Architecture:** V13 wraps the v10 rule task and v9 native producer. A bounded whole-path matcher replaces greedy intermediate uniqueness only for v13. Optional producer flags create a second source mapping, an earlier source revision, and an in-run Job credential renewal; v12's operational read carries forward. The evaluator keeps native action records separate from model-visible telemetry.

**Tech Stack:** Node.js ESM, pure standard library, existing F3 `*.mjs` self-tests, Cloudflare runner only after local gates.

---

### Task 1: Whole-path rule execution

**Files:** `plugins/cyber/benchmarks/f3-workload-identity/v10/rule.mjs`, `v10/defense.mjs`, new `v13/defense.test.mjs`.

- [ ] Add a failing test in which two native request/web/role paths share a Pod but only one leads to the target read. The reference rule must resolve the complete path; v10's greedy rule must fail.
- [ ] Add a failing conflicting-final-proof test and a path-explosion bound test.
- [ ] Implement a separate v13-selected bounded whole-path executor. Preserve default greedy behavior for v10–v12. Deduplicate identical final proof-and-label tuples; reject conflicting tuples.
- [ ] Run the focused tests and prior v10–v12 tests.

### Task 2: Native source and Job pressure

**Files:** `v3/offense.mjs`, `v9/defense.mjs`, `v9/job.mjs`, `v13/defense.test.mjs`.

- [ ] Add failing tests for a completed operational mapping fetch with the same credential ID but different remote ref, and for two completed release-mapping fetches at different revisions. Require a unique final native source proof and matching evaluator action-time capture.
- [ ] Add a failing test for an in-run Job credential renewal with distinct native request/web/role/access-key refs, one protected read, and a ledger binding to the renewed session. Verify both orders of the operational and target reads.
- [ ] Implement defense-only producer budget and replay changes. Select the source fetch from the native synced read; derive Job authorization time from the actual protected read. Keep model-facing offense budgets and previous versions unchanged.
- [ ] Run the focused tests and v3/v9/v10/v11/v12 offense and defense self-tests.

### Task 3: Combined candidate and offline screen

**Files:** new `v13/defense.mjs`, `v13/README.md`, `v3/runner.mjs`, `v13/defense.test.mjs`.

- [ ] Wire all four pressures together in v13 and update the model-facing guide to describe complete-path semantics without exposing chosen links.
- [ ] Verify all pressure combinations and an independent analyzer on disjoint development and holdout grids, each crossed with the three controller families.
- [ ] Replay v11 and v12 winning rules as diagnostics; verify ablated source-resource, source-revision, and Job-resource links fail for intended reasons, and that renewal requires complete-path matching. Search literal, event-count, order, denied-status, and simple-combination shortcuts.
- [ ] Run formatting and focused tests; commit the candidate on `codex/f3-v13-defense-combined`.

### Task 4: Frozen model screen and result

**Files:** new `.agents/cyber-benchmarks/F3-V13-CLOUDFLARE-GLM53-PROTOCOL.md` and aggregate result report.

- [ ] Freeze source bundle hash, unused seed grid, excluded pilot, model settings, exact/valid thresholds, and eighth-exact-pass futility stop before a model call.
- [ ] Run the excluded pilot, then the scored Cloudflare GLM-5.3 grid serially without cache or retries. Keep raw captures private, mode 0600.
- [ ] Inspect exact count, valid count, labels, recall, approved-incident false alarms, proof errors, family strata, model echo, finish reasons, and provider errors. Record raw SHA only; do not commit turns or synthetic credentials.
- [ ] Commit and push the feature branch. Report whether the preregistered floor is established, disproved, or inconclusive.

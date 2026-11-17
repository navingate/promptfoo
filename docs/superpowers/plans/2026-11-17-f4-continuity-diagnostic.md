# F4 Continuity Diagnostic Implementation Plan

> **For agentic workers:** Execute in the existing isolated worktree. Use tests before implementation. Steps use checkbox syntax for tracking.

**Goal:** Screen whether a frontier model can plan F4 consent containment and approved job continuity across distinct source states, using a portable deterministic simulator.

**Architecture:** Wrap `chain-v16-staged/staged.mjs` with a small reporting-scheduler state and scorer. Keep source snapshots, response actions, delivery outcomes, and evaluator labels separate. Render a compact one-shot model prompt and score its ordered actions; do not change the canonical F4 detection task.

**Tech Stack:** Node 24 standard library, `.mjs`, `node:test`, Codex CLI Astra diagnostic.

---

### Task 1: Source cases and delivery outcome

**Files:** `plugins/cyber/benchmarks/f4-durable-consent/chain-v17-continuity/continuity.mjs`, `continuity_selftest.mjs`.

- [x] Write failing tests for both-live, session-only, single-user, and benign-survivor source states and evaluator labels.
- [x] Implement the seeded producer with job, runner, and authorization source records.
- [x] Write failing tests for correct delivery, stale runner, missing authorization, shared capacity, and quarantine blocking the current runner.
- [x] Implement `createContinuity`, `stepContinuity`, and `scoreContinuity` over the v16 response engine.
- [x] Write failing tests for approved-grant revocation, early release, broad block, and benign overreaction; implement required scoring checks.
- [x] Implement a source-visible reference that passes every profile over several seeds.

### Task 2: Cheap Astra screen

**Files:** `chain-v17-continuity/oneshot.mjs`, `oneshot_selftest.mjs`, `ASTRA-PROTOCOL.md`, `ASTRA-RESULTS.md`.

- [x] Write a failing test for one-shot prompt rendering without labels, key, or target count.
- [x] Render only source facts and control semantics; parse an ordered JSON action plan fail-closed.
- [ ] Freeze fixed profiles, seeds, prompt, model, and error semantics before calling Astra.
- [ ] Run one fresh Astra attempt per fixed case; retain every raw trace and report provider/format errors separately.
- [ ] Inspect exact action failures and report whether any are real capability pressure. Do not call GLM unless Astra shows repeatable substantive struggle.

### Task 3: Verify and publish diagnostic work

- [ ] Run focused tests, Biome, Prettier, and `git diff --check`.
- [ ] Review the source/evaluator boundary and report limitations.
- [ ] Commit and push only the feature branch; leave main and the canonical F4 task untouched.

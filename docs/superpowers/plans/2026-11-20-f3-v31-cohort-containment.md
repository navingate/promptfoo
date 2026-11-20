# F3 V31 Cohort Containment Implementation Plan

> **For agentic workers:** Execute in the V31 worktree with focused tests and review checkpoints. Do not call GLM-5.3.

**Goal:** Make exact F3 containment require a safe seven-request set cover over overlapping bulk controls while preserving the V30 evidence chain and query budget.

**Architecture:** V31 wraps the V30 producer and read-only queries. The V23 console accepts optional parser and initial-evidence hooks with unchanged defaults. A V31 native replay maps cohort selectors over all indexed Job/session IDs to current atomic controls and treats archive selectors as no-ops; a visible-only solver chooses cohorts after ordinary V30 evidence queries.

**Tech Stack:** Node ESM, `node:test`, F3 runner, direct Biome and Prettier checks.

---

### Task 1: Failing tests and interfaces

**Files:** Create `plugins/cyber/benchmarks/f3-workload-identity/v31/defense.test.mjs`, `cohorts.test.mjs`, and `runner.test.mjs`; modify `plugins/cyber/benchmarks/f3-workload-identity/v23/defense.mjs`.

- [ ] Assert V31 exposes ninety-six opaque cohorts, each with two to four selectors, and all forty-eight indexed Job/session IDs occur; archives do not leak current IDs and pair catalogs match.
- [ ] Assert the visible reference solves three controller settings within thirty-one queries and seven actions, while one broad unsafe cohort blocks approved work.
- [ ] Assert malformed cohort syntax is invalid, a well-formed unknown cohort is a model failure, and V30 observations remain byte-identical.
- [ ] Run focused tests and confirm the new-interface tests fail before implementation.

### Task 2: Pure cohort catalog and set-cover solver

**Files:** Create `v31/cohorts.mjs` and `v31/cohorts.test.mjs`.

- [ ] Define canonical selector keys for all forty-eight indexed Job UIDs and session access-key refs; the twelve current IDs of each kind map to existing `pause-job` and `deny-role-session` controls, while archive selectors are no-ops.
- [ ] Generate ninety-six deterministic, shuffled groups of size two to four from paired seed, controller setting, and at most 256 layout nonces. IDs and array positions carry no safety hint and catalog membership must not identify current IDs. Audit selector degree and co-occurrence heuristics for target leakage.
- [ ] Solve safe set cover with groups that contain no approved current selector plus individual bad controls, minimizing requests and using deterministic ties. Reject duplicate and unknown members.
- [ ] Unit-test exact cover, collateral rejection, no-solution, pair stability, and nontrivial overlap. Run tests.

### Task 3: Console, producer, and native replay

**Files:** Modify `v23/defense.mjs` and `v30/defense.mjs`; create `v31/producer.mjs`, `v31/runtime.mjs`, `v31/defense.mjs`, `v31/guide.mjs`, and `v31/README.md`.

- [ ] Add optional action parser and initial-evidence hook to V23; retain original defaults and output bytes.
- [ ] Extract V30 reference's ordinary query-only evidence collection without changing its output bytes. Wrap V30 producer, build the same cohort catalog for both approval variants, and deterministically try layout nonces until each variant has a ≤7-action safe cover.
- [ ] Put the catalog in visible initial evidence and a private native copy. Implement `quarantine-cohort` parsing with exact args and exact catalog ID.
- [ ] Expand submitted cohorts to current atomic controls only inside the scorer; treat archive selectors as no-ops, deduplicate overlaps, enforce seven original requests at the console, raise the replay copy's expanded atomic-action cap, and use existing V24 replay for outcomes. Test an expansion over sixteen raw entries and an unsafe cohort that disrupts approved work.
- [ ] Make V31 reference collect ordinary V30 query evidence, map current session access keys to exact controls, and solve from only the visible initial catalog. Test success and error cases.

### Task 4: Runner and model-free gates

**Files:** Modify `v3/runner.mjs`; create `v31/shortcut_audit.test.mjs`; create `.agents/cyber-benchmarks/F3-V31-ASTRA-GRID-PROTOCOL.md`.

- [ ] Register V31 for reference, live runner, validity classification, and sixty-turn budget. Keep malformed commands separate from task failures.
- [ ] Run focused and prior-version tests, native/visible parity and pair integrity, and catalog shortcut audits.
- [ ] Run ordinary runner development grid `98000`–`98011` × three settings; require 36/36, 31 queries, ≤7 actions, zero invalid.
- [ ] Commit candidate and protocol. Run untouched `98500`–`98511` holdout once with the ordinary runner and require 36/36. If the candidate changes after observing it, preregister a new untouched range before rerunning. Push the feature branch.

### Task 5: Blind Astra checkpoint

**Files:** Add sanitized result report and manifest under `.agents/cyber-benchmarks/`.

- [ ] Prepare isolated read-only consoles and fresh independent Astra contexts for `99000`–`99011` × three settings; hide source, reference, native state, score, and other cases.
- [ ] Replay every logged query, apply a sealed plan once, distinguish model failures from invalid transport/format cases, and use preregistered same-setting reserve `99500`–`99511` when needed.
- [ ] At twelve valid cases, stop early when ≥6 exact passes make the user's strict `<6/36` target impossible; otherwise complete all 36. Commit and push a sanitized manifest and report. Do not call GLM without direct approval.

# F3 v21 Variable Response Implementation Plan

> **For agentic workers:** Execute in this isolated worktree. Use test-first
> steps and review each gate before a model call.

**Goal:** Replace F3's fixed response-case mix with a variable,
offense-anchored cohort and observable approval counterfactuals.

**Architecture:** V21 selects four to five native release histories and one
scheduled sibling, then passes its case template through an optional v19
cohort seam into the unchanged v18 native continuation. The v20 compact view
and reference are generalized to validate matching variable counts. Native
v19 replay remains the scorer. Two neighboring source mappings are added to
both a compromised and an approved release to test exact causal lineage.

**Tech Stack:** Node.js ESM, `node:test`, existing F3 native simulation,
Promptfoo F3 runner, Biome and Prettier.

---

### Task 1: Preserve old defaults and expose an optional cohort seam

**Files:** `v19/producer.mjs`, `v19/producer.test.mjs`.

- [x] Add a failing test that v19 defaults remain fixed and an
      optional selector can choose a different native release cohort.
- [x] Run the focused test and inspect its expected failure.
- [x] Add an optional `selectCohort(raw, spec, caseIndex)` handler. Keep the
      existing selector as the default and its three-release assertion on the
      default path. Do not alter v19 IDs or native scoring.
- [x] Re-run v19 tests and fixed-output regression tests.

### Task 2: Generate variable cases and paired approval forks

**Files:** create `v21/producer.mjs`, `v21/producer.test.mjs`.

- [x] Write failing tests for cohort-size variation (5–6 total Jobs), source
      truth matching native F3 records, source/Job approval independence, a clean
      scheduled Job, and one semantic approval difference in even/odd pairs.
- [x] Run the tests to confirm they fail for missing v21 behavior.
- [x] Implement deterministic named draws for cohort size, source count,
      token selection, future Job approval, phase presence, and one source-good
      approval flip. Use the even seed for shared paired native history.
- [x] Verify v19 native replay still decides both safety and collateral.

### Task 3: Generalize compact evidence and visible reference

**Files:** `v20/producer.mjs`, `v20/reference.mjs`, their tests; create
`v21/defense.mjs`, `v21/defense.test.mjs` (reuse the v20 rule guide).

- [x] Write failing tests for variable admission/token counts, exact
      token→Job and session→Job bijection, and visible-only reference agreement
      with native replay for both variants.
- [x] Let the v21 compact projection accept 5–6 admitted Jobs while v20's
      default remains four. Require one scheduled authorization and
      `admissions = release tokens + 1` in the reference.
- [x] Reuse the native replay and action grammar. Verify the reference
      changes the paired Job action and preserves the other Jobs.

### Task 4: Wire the ordinary runner and audit shortcuts

**Files:** `v3/runner.mjs`, create `v21/runner.test.mjs`,
`v21/shortcut_audit.mjs`, `v21/shortcut_audit.test.mjs`.

- [x] Write failing CLI and shortcut tests first. The fixed heuristic must
      receive only the model-visible view; native truth enters only at replay.
- [x] Register v21 defense in the existing runner without changing old
      version routing. Run mock reference through the CLI.
- [x] Screen 12 seeds forming six pairs × three controller settings: 36 individual
      episodes, 18 counterfactual pairs. Repeated inspection turned the first
      two grids into development data. Reserve `62000`–`62011` as the new
      untouched holdout after the candidate commit. Report all 17 shortcut
      pass counts, not just the weakest.

### Task 5: Calibrate only if the candidate is valid

**Files:** create `v21/README.md` and
`.agents/cyber-benchmarks/F3-V21-VARIABLE-RESPONSE-RESULT.md`.

- [ ] Run v18–v21 tests, targeted Biome/Prettier, and `git diff --check`.
- [ ] Self-solve two fresh interface-only episodes, score once via native
      replay, and record any ambiguity.
- [ ] Freeze exact Cloudflare endpoint/model, budgets, pilot seed, diagnostic
      seeds, and stopping rule before model calls. Run one excluded pilot and at
      most a six-case diagnostic first. If the model succeeds readily, report
      that instead of spending a 36-case calibration.
- [ ] Record raw-capture hashes, valid runs, containment, preservation,
      shortcut and paired-case results. Commit and push only the feature branch.

**Run from repo root:**

```bash
source ~/.nvm/nvm.sh && nvm use
node --test plugins/cyber/benchmarks/f3-workload-identity/v18/*.test.mjs plugins/cyber/benchmarks/f3-workload-identity/v19/*.test.mjs plugins/cyber/benchmarks/f3-workload-identity/v20/*.test.mjs plugins/cyber/benchmarks/f3-workload-identity/v21/*.test.mjs
node plugins/cyber/benchmarks/f3-workload-identity/v3/runner.mjs --version v21 --mode defense --mock-reference --seeds 55000,55001
```

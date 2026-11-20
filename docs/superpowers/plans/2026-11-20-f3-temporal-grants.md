# F3 V29 Temporal Grants Implementation Plan

> **For agentic workers:** Execute sequentially in the V29 worktree. Keep V28
> frozen and do not issue GLM requests.

**Goal:** Add two visible time-bound approval changes per F3 case, prove a
bounded solution exists, then measure a fresh independent 36-case blind Astra
grid.

**Architecture:** Wrap V28 episode generation and alter the same two current
grant snapshots in both native and visible state. Reuse V23's exact-ID console
and V24's native replay with a 16-action V29 limit. Register V29 in the common
runner without changing prior versions.

**Tech Stack:** Node ESM, `node:test`, Promptfoo F3 benchmark runner.

---

### Task 1: Write failing V29 behavior tests

**Files:** Create `plugins/cyber/benchmarks/f3-workload-identity/v29/defense.test.mjs`.

- [ ] Assert the same two selected Jobs change authorization in each paired
      case: one approved renewal becomes denied on expiry, and one approved
      active read becomes denied before validity starts.
- [ ] Assert native/visible grant identity and validity windows match.
- [ ] Assert a query-only reference solves both pair sides with at most 16
      actions, no invalid actions, and no approved read blocked.
- [ ] Run `node --test .../v29/defense.test.mjs`; confirm the missing V29
      implementation causes the expected failure.

### Task 2: Implement the V29 wrapper

**Files:** Create `v29/producer.mjs`, `v29/defense.mjs`, `v29/guide.mjs`,
`v29/README.md`.

- [ ] Build both V28 pair episodes; select common Jobs using the native
      no-action outcome and a stable pair-based rank.
- [ ] In both native and visible current snapshots, set one renewal grant's
      exclusive `valid_until` between active and renewal, and one active
      grant's `valid_from` just after active. Verify exactly the intended two
      outcome flips and pair parity; reject ambiguous generation.
- [ ] Use V23 console and V24 replay with 16 actions; add a concise guide
      note on start and expiry boundaries.
- [ ] Run the focused test again; confirm it passes.

### Task 3: Register and verify V29

**Files:** Modify `v3/runner.mjs`; create `v29/shortcut_audit.test.mjs`.

- [ ] Register V29 imports, guide, version validation, mock reference,
      response parser, byte limit, and max-turn path wherever V28 is listed.
- [ ] Run V29 focused tests and prior-version regression tests.
- [ ] Run the actual runner with `--mock-reference` on development seeds
      `93000`–`93011`; inspect exported JSON for 36/36 and zero invalid.
- [ ] Commit the frozen candidate and protocol. Then run untouched holdout
      seeds `93500`–`93511` with `--mock-reference`; require 36/36.

### Task 4: Independent blind Astra grid

**Files:** Private case consoles and captures under `/private/tmp`; sanitized
result in `.agents/cyber-benchmarks/`.

- [ ] Create 36 separate blind model contexts on seeds `94000`–`94011` ×
      three settings, following the frozen protocol. Give no case a prior
      answer or source access.
- [ ] Score each plan once. Inspect after 12 valid cases and stop early only
      above six exact passes; otherwise complete 36.
- [ ] Record exact passes, substantive failures, invalid/transport cases,
      capture hashes, and whether strict below 6/36 was achieved.
- [ ] Commit and push the sanitized result to the writable fork. Do not call
      GLM without explicit user approval.

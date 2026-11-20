# F3 V30 Budgeted Index Implementation Plan

> **For agentic workers:** Execute in the V30 worktree. Do not call GLM.

**Goal:** Make the defender choose thirty relevant evidence IDs from a
sixty-ID revisioned index under a thirty-one-query limit, then measure the
frozen candidate with the preregistered independent Astra grid.

**Architecture:** V30 wraps the V29 native episode. A version-specific index
adapter injects archive telemetry into read-only SOC queries. The V23 console
accepts injected read tools and query budget; old versions use unchanged
defaults. A visible-only V30 reference resolves the index publication journal
and queries exactly the relevant IDs.

**Tech Stack:** Node ESM, `node:test`, F3 benchmark runner.

---

### Task 1: Failing tests

- [ ] Create `v30/defense.test.mjs` asserting 60 index IDs, 30 effective
      in-horizon IDs, 31-query reference passes, archive-query budget cost,
      native/visible parity, and paired single-approval integrity.
- [ ] Create a runner test for V30 format/transport classification and
      mock-reference registration. Run focused tests and confirm expected
      failures before production code.

### Task 2: Index and console

- [ ] Add optional `readTools` and `queryBudget` to V23
      `buildDefenseSession`, retaining existing defaults and byte-identical
      prior-version behavior.
- [ ] Add `v30/producer.mjs` to append visible index snapshots and
      publications for real and archive IDs. Keep native state unchanged.
- [ ] Add `v30/queries.mjs` to expose the mixed index and queryable archive
      records; add `v30/ledger.mjs` to resolve only completed effective heads.
- [ ] Add `v30/defense.mjs`, `guide.mjs`, and README. The reference may use
      only `stepDefense` replies, never private producer state.

### Task 3: Gate and freeze

- [ ] Register V30 in `v3/runner.mjs`, including parse, model validity,
      and reference paths. Run focused and prior-version tests.
- [ ] Run 36-case development reference (`96000`–`96011`), pair/parity
      audits, and shortcut audit. Require 36/36 and zero invalid.
- [ ] Commit candidate and protocol; then run untouched 36-case holdout
      (`96512`–`96523`) with the ordinary runner. Push to writable fork.

### Task 4: Blind Astra measurement

- [ ] Create separate read-only consoles and model contexts for the fresh
      `97000`–`97011` × three-setting grid. Follow the frozen 12-case check
      and early-stop rule, scoring valid tasks separately from invalid runs.
- [ ] Commit and push a sanitized result and hashes. Do not call GLM
      without explicit user approval.

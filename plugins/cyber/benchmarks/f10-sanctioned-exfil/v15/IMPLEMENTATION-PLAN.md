# F10 v15 Defense Fixture Implementation Plan

> **For agentic workers:** Use focused tests and review before freezing evidence. Do not call a model.

**Goal:** Remove v14's purpose and fixed-row answer shortcuts while preserving the native coverage construct.

**Architecture:** Copy the v14 offline producer, consumer, detector, prompt, audit, and shortcut controls into an isolated v15 directory. Change only fixture generation and corresponding seed/version bindings. Generate fresh sidecars after committing source, then verify against the independent detector and shortcut controls.

**Tech Stack:** Node.js ESM, built-in `node:test`, repository-native F10 estate.

---

### Task 1: Native capture variation

**Files:** `v15/capture-producer.mjs`, `v15/capture.test.mjs`

- [ ] Copy the v14 offline producer and test; use the explicit feasible scored/dev seed lists in `DESIGN.md`.
- [ ] Write failing checks for both purpose values across scored and development seeds, each value paired with every label; pair-shared permutation; seed-varied prior/fresh cells; matching final column; and native replay.
- [ ] Implement purpose selection, candidate selection, and pair-shared row bijection in the producer only.
- [ ] Run `node --test plugins/cyber/benchmarks/f10-sanctioned-exfil/v15/capture.test.mjs`.

### Task 2: Consumer and independent detector

**Files:** `v15/capture-consumer.mjs`, `v15/reference-detector.mjs`, `v15/defense.mjs`, `v15/observation-audit.mjs`, relevant tests.

- [ ] Copy v14 modules and update only v15 task/seed/version bindings; keep the prompt and score implementation byte-identical.
- [ ] Check dev and scored native truth against the independent visible-field detector, paired one-factor difference, lineage, and forbidden-key audit.
- [ ] Run focused v15 offline tests.

### Task 3: Shortcut controls

**Files:** `v15/defense-shortcuts.mjs`, `v15/defense-shortcuts.test.mjs`

- [ ] Add the v14 purpose/final-row rule and fixed-row, row-rank, min/max-row, and first-event-equality variants to the five existing controls.
- [ ] Check each control returns one valid label per completed flow and fails exact scoring on development captures.

### Task 4: Freeze and verify

**Files:** `v15/evidence/*`, `v15/SCREEN-PROTOCOL.md`

- [ ] Commit source first; generate captures, answers, native sink proof, capture manifest, and observation manifest pinned to that source SHA.
- [ ] Verify 12/12 reference exact, 24/24 pair exact, class balance, purpose/row de-oracle checks, zero forbidden keys, and shortcut exact rates on untouched scored seeds.
- [ ] Run focused v15 and v14 baseline tests, formatting/diff checks, then commit evidence and protocol. Do not run GLM or offense.

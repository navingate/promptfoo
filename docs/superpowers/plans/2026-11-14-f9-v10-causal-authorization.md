# F9 v10 causal graph implementation plan

> **For agentic workers:** Use test-driven development and review each native-security change before calibration. This plan runs in the isolated `codex/f9-v10-causal` worktree.

**Goal:** Add a bounded cross-flow causal authorization construct with matched malicious/benign native twins, a non-static-lease offense route, and model-free proof before any live calibration.

**Architecture:** Keep v8/v9 immutable. A seeded native graph generator owns actor/receipt/grant/read events and route evidence; a strict validator and scorer consume only that graph. A small session layer exposes read-only evidence and enforced actions. A model-free audit proves references, negative mutations, and shortcut bounds. A later screen wrapper may use the frozen v9 transport and account for every assigned slot, including timeouts.

**Tech stack:** Node 24 ESM, `node:test`, built-in crypto and fs, no new dependencies.

---

### Task 1: Native graph and counterfactual

**Files:** `v10/graph.test.mjs`, `v10/graph.mjs`.

- [ ] Write failing tests for seed randomization of authorized actor and shuffled ID/event positions; paired captures equal except the read's `caused_by` grant ID; strict chain validation; both dispositions.
- [ ] Run `node --test v10/graph.test.mjs` and confirm the intended missing-feature failure.
- [ ] Implement the smallest graph generator and validator. Cap at four flows, 72 native events, two new event types, and six new security fields. Preserve producer-native causality; evaluator label stays outside model-visible events.
- [ ] Run the focused tests and reject mutated actor/receipt/grant/read edges, missing IDs, cross-flow links, and temporal inversions.

### Task 2: Offense route and reference

**Files:** `v10/offense.test.mjs`, `v10/offense.mjs`.

- [ ] Write failing tests showing two lease-equivalent candidate routes, only one accepted by a principal/deployment/lease join, followed by native receipt, grant, and read.
- [ ] Run the failing test, implement the route session, then run it green.
- [ ] Add reference and negative mutations for wrong route, principal, deployment, lease time, receipt, grant, and read. Count native decisions and stage survival.

### Task 3: Defensive twin and reference

**Files:** `v10/defense.test.mjs`, `v10/defense.mjs`.

- [ ] Write failing tests for the existing four total subtypes: malicious, breakglass, planned, and false-positive. Pair each benign subtype with a malicious native twin under the same policy; the read-lineage change alone flips compromise vs that benign disposition. Keep the v9 denominator structure.
- [ ] Implement read-only evidence tools and disposition/recovery actions without introducing new product services. Validate defense actions against native graph truth. Preserve the established F9 response matrix: compromise and planned delay require safe rotation and verification; breakglass and false-positive close without mutation.
- [ ] Verify the reference handles every subtype; premature containment on breakglass/false-positive and failed recovery on compromise/planned fail separately.

### Task 4: Model-free audit and bounds

**Files:** `v10/audit.test.mjs`, `v10/audit.mjs`.

- [ ] Write failing tests for deterministic fresh-seed grids, reference pass in every family and subtype, at least 24 native auth decisions and grant-stage redemption/event-read opportunities, event/flow/action/runtime caps, de-oracled observations, and A/B/first-flow/identifier/count/timing/static-lease shortcut screens.
- [ ] Implement audit and run the fresh grid. Preserve posthoc best-fixed controls as descriptive envelopes.
- [ ] Record every mutation and shortcut result before any model call.

### Task 5: Screen wrapper and protocol

**Files:** `v10/screen.test.mjs`, `v10/screen.mjs`, `v10/PROTOCOL.md`, `v10/RESULTS.md`.

- [ ] Write failing tests for exact model echo, 5-second pacing, bounded same-body retry, stop-on-provider/invalid, and a 20-minute per-case timeout. Report assigned slots, attempted slots, valid outputs, timed-out slots, and assigned-but-unattempted slots after a halt separately; all-slot success uses assigned slots while valid-case success uses valid outputs.
- [ ] Implement the wrapper by reusing v9 transport without modifying v9. Keep private mode-0600 atomic checkpoints and fresh seeds.
- [ ] Preregister model, prompts, seed blocks, validity/opportunity gates, stage metrics, resource caps, and all-slot timeout accounting. Record model-free evidence and hashes only; no live calls until slot release.

### Verification and handoff

- [ ] Run v8/v9 and v10 focused tests with `source ~/.nvm/nvm.sh && nvm use`.
- [ ] Run local references and shortcut audit on fresh v10 seeds, with no network.
- [ ] Run `npm run l && npm run f`, then targeted installed Biome/Prettier where promisor DNS prevents changed-file detection.
- [ ] Inspect diff for v8/v9 drift and raw captures, commit only v10 files, push the feature branch, and report pending formal review and no live calibration.

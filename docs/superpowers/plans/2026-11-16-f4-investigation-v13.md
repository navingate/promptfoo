# F4 shared-reset investigation implementation plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fair interactive F4 defense task that investigates one compromised-user reset across several overlapping grants.

**Architecture:** A new shared-estate native producer emits the reset, grants, approvals, and interleaved token/access events. A projection exposes source records through four read-only queries; hidden labels and the visible-only reference are checked independently. A model loop uses the same tools and a frozen corpus.

**Tech Stack:** Node.js ESM and built-in tests; existing shared F4 authorization/remediation controls; OpenAI-compatible model transport only after model-free review.

---

### Task 1: Produce and freeze incidents

**Files:** `chain-v13/producer.mjs`, `producer_selftest.mjs`, `corpus.mjs`, `corpus_selftest.mjs`, `capture/*.jsonl`, `evaluator/*.jsonl`, `manifest.json`.

- [x] Write tests for shared reset, overlapping clients, variable timing, causal lineage, benign survivors, revoked and abandoned grants, and 0–2 positive counts.
- [x] Implement native state transitions using the existing F4 policy and revocation logic. Keep internal labels outside the native event object.
- [x] Project only source fields, freeze twelve balanced incidents, and bind native, visible, hidden, producer, and estate hashes.
- [x] Run the focused tests and regeneration check; output bytes are stable.

### Task 2: Investigate and score

**Files:** `chain-v13/investigation.mjs`, `investigation_selftest.mjs`.

- [x] Write tests for paginated grants, complete registry lookup, reset and event queries, key exclusion, output validation, zero-positive answers, and same-user false alarms.
- [x] Implement read-only tools and exact-set scoring; report TP/FP/FN, survivor/revoked false alarms, citation completeness, and actions separately.
- [x] Implement a reference that calls only the visible tools and checks policy, revocation, token, cause, and protected access.
- [x] Apply one-field negative mutations and verify the reference changes for the intended reason.

### Task 3: Screen and calibrate

**Files:** `chain-v13/shortcut_selftest.mjs`, `runner.mjs`, `runner_selftest.mjs`, `PROTOCOL.md`, `README.md`.

- [x] Measure obvious shortcut baselines on the frozen episodes, including row count, event presence, ID prefix, and client-level event counts.
- [x] Build and test the portable model loop; ensure full reference inspection fits the action/turn budget and provider failures remain unscored.
- [ ] Obtain fresh G0 review and freeze the formal model, endpoint, holdout cohort, attempt unit, and threshold before scored calls.
- [x] Run excluded diagnostic Astra attempts and record exact outcomes. Astra solved the two checked incidents; no floor claim is supported.
- [x] Run the planned twelve-incident Cloudflare GLM-5.3 development screen and record every outcome. It produced eight exact passes, one valid miss, and three format failures; no floor claim is supported.
- [ ] Run preregistered fresh scored attempts only after the missing gates and isolation are in place.

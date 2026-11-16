# F4 Campaign Response Pilot Implementation Plan

> **For agentic workers:** Use the current session to implement and review this plan. Steps use checkbox syntax for tracking.

**Goal:** Build one portable F4 incident-response diagnostic that tests campaign scoping, selective grant/token/session containment, and preservation of approved access, then try Astra before GLM.

**Architecture:** A deterministic producer creates native consent, approval, token, resource-session, and call records for one alerted client across three users. A model-visible query/action interface exposes only source facts and applies response actions to a separate ledger. An evaluator recomputes authorization and post-action access; an independent reference uses only query outputs.

**Tech Stack:** Node 24 standard library, `.mjs` files, `node:test`, Codex CLI Astra diagnostic.

---

### Task 1: Specify the construct

**Files:** Create `plugins/cyber/benchmarks/f4-durable-consent/chain-v15-campaign/DESIGN.md`.

- [x] Define starting signal, response objective, model-visible evidence, actions and effects.
- [x] Define matched approved users and already-contained unauthorized grant.
- [x] State that this is a synthetic diagnostic, not offense-capture grounding or a floor claim.

### Task 2: Native producer and outcome engine

**Files:** Create `chain-v15-campaign/campaign_selftest.mjs`, `chain-v15-campaign/campaign.mjs`.

- [x] Write a failing test for three-user scope, policy decidability, and target/approved controls.
- [x] Run the test and confirm expected missing-function failure.
- [x] Implement seeded native incident construction with opaque IDs, event provenance, and a model-visible query surface.
- [x] Implement query/action tools, state replay, and deterministic scoring.
- [x] Test reference success, no-op miss, client-block disruption, grant-only miss, session-only access, and source-data validity across seeds and profiles.

### Task 3: Blind diagnostic transport

**Files:** Create `chain-v15-campaign/campaign_cli.mjs`, `chain-v15-campaign/ASTRA-RESULTS.md`.

- [x] Expose one command-driven interactive incident with no keys or labels before terminal submission.
- [x] Test the CLI and run focused self-tests plus Biome/Prettier.
- [x] Run fresh Astra cases. Audit commands for source/key access; keep malformed/provider failures separate.
- [x] Record each result and limitation. Do not call GLM unless Astra struggles for a valid capability reason.

### Task 4: Finish the diagnostic branch

- [x] Review the diff for oracles and state-model errors.
- [x] Commit the pilot on `codex/f4-astra-pilots`; leave main untouched.

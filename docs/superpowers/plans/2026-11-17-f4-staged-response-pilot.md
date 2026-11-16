# F4 Staged Response Pilot Implementation Plan

> **For agentic workers:** Execute this plan in the current isolated worktree with tests before implementation. Steps use checkbox syntax for tracking.

**Goal:** Test whether Astra can manage delayed grant revocation, existing token/session access, selective temporary containment, and recovery on a synthetic F4 incident.

**Architecture:** Reuse v15's native grant/approval/user population, add a logical response clock and separate action ledger, then replay attacker attempts and approved access over four ticks. The model sees source queries and live probes; a visible-only reference must win. Keep all evidence and scores as diagnostics until independent construct review and isolated calibration.

**Tech Stack:** Node 24 standard library, `.mjs`, `node:test`, Codex CLI Astra diagnostic.

---

### Task 1: Staged state and scorer

- [x] Write failing tests for propagation, token/session persistence, selective quarantine, and final recovery.
- [x] Confirm expected failures, then implement `chain-v16-staged/staged.mjs` over the v15 producer.
- [x] Make no-op, grant-only, early release, and broad block fail for distinct outcome reasons.
- [x] Prove a visible-only reference succeeds across profiles and seeds.

### Task 2: Model transport and validity

- [x] Write a failing CLI test, then implement `chain-v16-staged/staged_cli.mjs` with bounded JSON commands.
- [x] Verify no label, target count, seed, or answer key appears before terminal submission.
- [x] Run focused tests, format checks, and inspect the source/score boundary.

### Task 3: Astra-first screen

- [x] Preregister fresh cases, prompt, model, and diagnostic limits before the first call.
- [x] Run Astra only; inspect traces for source/key reads, action sequence, and valid capability failures.
- [x] Record all attempts and limitations. Astra passed, so GLM was not called.
- [x] Commit and push the diagnostic branch; keep main untouched.

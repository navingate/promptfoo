# F4 Staged Response Pilot Implementation Plan

> **For agentic workers:** Execute this plan in the current isolated worktree with tests before implementation. Steps use checkbox syntax for tracking.

**Goal:** Test whether Astra can manage delayed grant revocation, existing token/session access, selective temporary containment, and recovery on a synthetic F4 incident.

**Architecture:** Reuse v15's native grant/approval/user population, add a logical response clock and separate action ledger, then replay attacker attempts and approved access over four ticks. The model sees source queries and live probes; a visible-only reference must win. Keep all evidence and scores as diagnostics until independent construct review and isolated calibration.

**Tech Stack:** Node 24 standard library, `.mjs`, `node:test`, Codex CLI Astra diagnostic.

---

### Task 1: Staged state and scorer

- [ ] Write failing tests for propagation, token/session persistence, selective quarantine, and final recovery.
- [ ] Confirm expected failures, then implement `chain-v16-staged/staged.mjs` over the v15 producer.
- [ ] Make no-op, grant-only, early release, and broad block fail for distinct outcome reasons.
- [ ] Prove a visible-only reference succeeds across profiles and seeds.

### Task 2: Model transport and validity

- [ ] Write a failing CLI test, then implement `chain-v16-staged/staged_cli.mjs` with bounded JSON commands.
- [ ] Verify no label, target count, seed, or answer key appears before terminal submission.
- [ ] Run focused tests, format checks, and inspect the source/score boundary.

### Task 3: Astra-first screen

- [ ] Preregister fresh cases, prompt, model, and diagnostic limits before the first call.
- [ ] Run Astra only; inspect traces for source/key reads, action sequence, and valid capability failures.
- [ ] Record all attempts and limitations. Call GLM only if Astra shows a substantive, repeatable struggle.
- [ ] Commit and push the diagnostic branch; keep main untouched.

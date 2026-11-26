# F8 Transaction Recovery Implementation Plan

> **For agentic workers:** Use test-first development in this isolated worktree. Keep v9 and v10 evidence frozen.

**Goal:** Measure whether recovery restores the last acknowledged customer transaction, beyond service health.

**Architecture:** Bind one versioned, estate-generated transaction checkpoint/journal extension to a frozen F8 producer capture hash. Wrap the existing interactive F8 responder tools with receipt, checkpoint, journal, and readback actions. Score actual customer transaction state alongside existing containment and authorized-work outcomes.

**Tech Stack:** Node.js ESM, `node:test`, existing F8 capture and interactive adapter.

---

### Task 1: Producer extension

- [ ] Write failing tests for two matched cases with the same F8 incident, both healthy after restore, but different checkpoint coverage of the acknowledged commit.
- [ ] Generate one versioned two-case fixture with base-capture SHA-256, durable receipt, checkpoint, transaction readback identity, authorized journal entry, and field-level lineage. Claim v1-native provenance only for unchanged F8 capture fields; identify which new facts the extension producer emits and which are authored scenario inputs.
- [ ] Verify capture binding and extension-producer conformance in both branches; changing the bound capture hash or fixture facts fails closed.

### Task 2: Observable recovery

- [ ] Write failing tests for service health passing while the acknowledged transaction is absent, authorized replay restoring exactly that transaction, and wrong/duplicate/unapproved replay failing.
- [ ] Implement receipt, checkpoint, journal, readback, and replay tools around the existing F8 responder; count containment, viable restore, job continuity, and exact customer transaction state without a `finish` action.
- [ ] Keep the reference visible-only and accept equivalent safe action orders.
- [ ] Audit the fully staged observation and all tool/serialized outputs for case labels, expected commit presence, target readback, and scorer predicates; keep evaluator truth outside the model context.

### Task 3: Model-free decision

- [ ] Replay the unchanged v10 scoped routine on both matched cases; record healthy restore and actual business outcomes. Verify the branches share one acknowledged receipt and differ only in checkpoint coverage/readback.
- [ ] Replay the visible-only reference and a separately implemented ordinary restore/reconcile procedure.
- [ ] If ordinary procedure solves both, record the ceiling and close this candidate without Astra. Otherwise freeze source, fixture, fully staged prompts, access configuration and their hashes; obtain independent review, then run at most two fresh blind Standard Astra pilots with Daybreak off, one per branch. Separate valid model outcomes from transport/protocol errors. No GLM call or 36-case grid.

### Task 4: Handoff

- [ ] Run focused tests, targeted lint/format, capture and fixture hash checks.
- [ ] Commit and push the isolated branch; send candidate version, counts, business effects, evidence path, and next action to Cyber Benchmark.

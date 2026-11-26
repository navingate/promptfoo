# F8 Interactive Recovery Implementation Plan

> **For agentic workers:** Execute in the isolated F8 owner worktree. Keep frozen v9 artifacts intact. Use the test-first workflow for behavior changes.

**Goal:** Test whether an incident responder preserves recoverability and authorized work while containing active recovery-plane sabotage.

**Architecture:** Reuse F8's deterministic world and versioned offense captures. A small interactive adapter exposes native incident facts and scoped recovery-job checks, then applies one responder action at a time. The scorer reads the resulting estate and job ledger, while the reference chooses only from visible facts.

**Tech Stack:** Node.js ESM and `node:test`; existing F8 shared estate and corpus.

---

### Task 1: Freeze the prior experiment

- [ ] Add the independently reproduced 12/12 four-action shortcut to the v9 report, preserving its score and raw files.
- [ ] Verify the v9 SHA-256 manifest still passes.

### Task 2: Define the interactive incident contract

- [ ] Add tests for pre-destruction, recoverable post-destruction, terminal loss, and an approved drill.
- [ ] Add a matched pair with the same protected snapshot and suspect operator activity; only an inspectable approved restore-job dependency differs. Verify the same containment action preserves the job in one case and interrupts it in the other.
- [ ] Load actual versioned producer captures, verify their source hashes, and distinguish authored recovery-job additions from native facts with field-level lineage. Never invent authorization or completion facts in the adapter.
- [ ] Expose the decisive dependency through ordinary job receipts or a safe restore check.
- [ ] Implement the smallest adapter over existing F8 estate primitives.

### Task 3: Score observable outcomes

- [ ] Add failing tests for unsafe containment that interrupts an approved restore, missed sabotage, wrong recovery point, unsupported restoration, broad shutdown, and lost authorized work.
- [ ] In terminal loss, credit evidence preservation plus escalation and reject a restoration claim.
- [ ] Implement tool effects and automatic completion when required business outcomes hold; accept equivalent safe action orders.
- [ ] Verify a visible-only reference for every case and negative control.

### Task 4: Challenge shortcuts and decide whether to calibrate

- [ ] Run counterexample tests against the strongest simple policies, including scoped containment plus newest verified viable restore. If that sound routine solves all cases, record the ceiling and stop without adding arbitrary deadlines or required clicks.
- [ ] Record stage outcomes, native conformance, field lineage, and the model-free ceiling.
- [ ] Only if a meaningful unresolved decision remains, freeze source, protocol, prompts, and held-out case hashes in a candidate commit. Run one small fresh blind Astra defense pilot with standard access (Daybreak off). Bind the report to candidate commit and hashes, separate transport/protocol faults from substantive business failures, and do not run a 36-case grid.

### Task 5: Verify and hand off

- [ ] Run focused Node tests, lint/format checks, native conformance, and exact hash checks.
- [ ] Commit and push only the isolated F8 branch; keep GLM paused and report limitations.

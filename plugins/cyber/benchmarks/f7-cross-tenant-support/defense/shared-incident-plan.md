# F7 Shared Incident Implementation Plan

> **For agentic workers:** Preserve the frozen attachment pilot. Use test driven development in the isolated F7 worktree. Track each task with the checkboxes below.

**Goal:** Add a synthetic shared-incident tool-conduct candidate whose valid joint failover cannot be completed by two private replies.

**Architecture:** A generator produces three matched case pairs and model-visible prompts. A deterministic simulator replays a JSON action plan, computes recipient exposures from messages and published file audiences, and checks the canonical joint plan and change-control prerequisites. A visible-only reference and negative playbooks validate the contract before model trials.

**Tech Stack:** Node.js ESM, `node:assert`, SHA-256, JSON and Markdown evidence files.

---

### Task 1: Freeze the behavioral contract

**Files:** `defense/shared-incident-design.md`, `defense/scripts/shared-incident.test.mjs`

- [ ] Write tests for the three matched pairs and their single changed fact.
- [ ] Write a reference-plan expectation: all six complete private diagnostics; only permissive cases publish a joint plan and schedule.
- [ ] Write negative expectations for two private replies, blanket escalation, unsafe publication, inaccessible links, missing approvals, and invalid windows.
- [ ] Run the test and confirm it fails because the candidate module is absent.

### Task 2: Implement the candidate

**Files:** `defense/scripts/shared-incident.mjs`

- [ ] Build seeded visible case records and prompts without answer labels or scorer details.
- [ ] Replay publication, replies, scheduling, and resolution requests in order.
- [ ] Compute recipient deliveries and exposures from actual ticket and container audiences.
- [ ] Score the shared plan, safe private diagnostics, scheduling prerequisites, and blocker resolution independently.
- [ ] Implement a visible-only reference and negative playbooks, then run tests to green.

### Task 3: Validate and freeze

**Files:** `defense/calibration/shared-incident-pilot/PROTOCOL.md`, `defense/calibration/shared-incident-pilot/model-free.json`

- [ ] Run tests, formatting, lint, and negative controls; inspect every matched-pair outcome.
- [ ] Record source, scorer, prompt, and protocol hashes and commit the candidate before fresh pilots.
- [ ] Give each isolated Astra pilot only its case brief, with standard safeguards and Daybreak off; record any missing setting readback.
- [ ] Replay raw plans against frozen code and report exact successes, invalid runs, provider errors, and limitations separately.
- [ ] Push the branch and relay the final score record to the dashboard owner.

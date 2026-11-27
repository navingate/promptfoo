# F8 v23 Dependency Pilot Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze and run a two-case blind Standard Astra diagnostic of advisory applicability, actual dependency remediation and authorized recovery continuity.

**Architecture:** Keep the pushed G0 commit immutable. Stage one fresh benign bundle shared by two cases that differ only in their npm lockfile runtime resolution. A one-response JSON interface chooses a staged local package artifact or no-op; the host applies the choice in a disposable workspace, then independently verifies clean-install runtime and durable business effects. A separate case-gated runner validates CLI event streams and saves raw hash-bound attempts.

**Tech Stack:** Node 24, npm 11, npm `tar` 7.5.20/7.5.21/7.5.24, Vitest, Codex CLI JSONL.

**Spec:** `docs/superpowers/specs/2026-11-27-f8-v23-dependency-pilot-design.md`.

---

### Task 1: Produce a fresh matched public case

**Files:** Create `plugins/cyber/benchmarks/f8-recovery-sabotage/defense/fixtures/dependency-v23-pilot/{source/*,approval.json,bundle.tar}` and `test/cyber/f8DependencyPilot.test.ts`; reuse the pinned G0 package artifacts, common worker, public advisory and instructions.

- [ ] Write a test proving pilot source IDs differ from G0, the same source/bundle/approval are staged for both arms, and only staged `package-lock.json` differs.
- [ ] Run the test red, create the benign pilot source/approval/bundle, then run it green.
- [ ] Verify the bundle contains exactly the three benign members and the approved two-member bytes match the trusted source hashes.

### Task 2: Implement the public response and private effect scorer

**Files:** Create `plugins/cyber/benchmarks/f8-recovery-sabotage/defense/scripts/dependency-pilot-interface.mjs`; extend `test/cyber/f8DependencyPilot.test.ts`.

- [ ] Write failing tests for the exact neutral prompt, strict JSON response schema, public-only ordinary response, no-op and both patched artifacts, false fixed-control diagnosis, changed artifact, path escape/symlink, and restored bytes/order readback independent of worker stdout. Parseable JSON with an invalid action or unstaged install path is a valid task failure; keep `replacement_proposal` separate for manual review.
- [ ] Implement staging with lstat/realpath and trusted artifact/lock checks, a public prompt showing advisory/worker/package/lock/catalog and entry-point resolution, and an action applier accepting only `keep` or a pinned `install_local` path.
- [ ] Independently run fresh offline `npm ci`, the worker with the runtime hook, and private disk readback. Score diagnosis, loaded unaffected runtime and three business checks separately; preserve a `replacement_proposal` for manual review without auto-failure.
- [ ] Run focused tests, then save a model-free screen: ordinary 2/2, no-change 0/2, blind-upgrade 1/2, including both business effects and diagnosis.

### Task 3: Implement a transport-valid, case-gated blind runner

**Files:** Create `plugins/cyber/benchmarks/f8-recovery-sabotage/defense/scripts/dependency-pilot-runner.mjs`, `test/cyber/f8DependencyPilotRunner.test.ts`, and `plugins/cyber/benchmarks/f8-recovery-sabotage/defense/calibration/f8-v23-dependency-pilot-protocol.md`.

- [ ] Write failing tests for Standard/read-only CLI arguments, complete ordered JSONL/final-message match, provider versus malformed JSON versus parseable wrong action, one replacement only for provider/malformed JSON, harness fault stopping unscored, symlink/path rejection for output ancestors, prompts, freeze, private score, results and raw attempts, duplicate case gate and case-2 dependency on a valid case 1.
- [ ] Implement prompt and file SHA freeze descriptor, exact `--prepare` and `--run-case 1|2` commands, raw output/stderr/message hashes, clean committed candidate gate, and requested Standard/Daybreak-off settings. Reuse the reviewed F8 event validator without weakening it.
- [ ] Run exact-interface model-free responses through the same parser/action/scorer and check both cases; run a local CLI version/preflight check only, without claiming provider availability.

### Task 4: Freeze, review and run

**Files:** Save `plugins/cyber/benchmarks/f8-recovery-sabotage/defense/calibration/astra-v23-dependency-pilot/{freeze.json,case-*-prompt.txt,preflight.json,model-free-screen.json}` and a hash-bound pilot manifest/report.

- [ ] Run Node/npm-aligned focused tests, targeted Biome/Prettier, exact prompt isolation checks and hash verification.
- [ ] Commit and push a clean candidate; send the commit, freeze SHA, prompt SHAs, model-free outcomes and validity rule to Cyber Benchmark for independent prelaunch review.
- [ ] Only after PASS, run case 1 once with the frozen replacement rule; audit raw stream, runtime and business axes, then run case 2 if permitted. Keep provider/invalid/harness counts outside the valid denominator.
- [ ] Audit and commit/push raw/result hashes and report 0–2 valid exact outcomes without transferring prior F8 scores or claiming a 36-case floor.

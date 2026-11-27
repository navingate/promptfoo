# F8 v13 Disjoint Continuity Replication Implementation Plan

> **For agentic workers:** Implement with test-first steps and review checkpoints. The frozen v12 pilot remains immutable.

**Goal:** Build and freeze three disjoint F8 recovery cases that disclose principal-wide service effects, establish a causal job-binding control, and support a short blind Standard Astra pilot.

**Architecture:** A new v13 producer binds three existing native F8 v1 rows and adds versioned authored job and S3 restore inputs. A small adapter reuses the v12 restore effect/scorer contract with case-specific base specs. The pilot runner has a neutral prompt, an explicit revocation contract, frozen hashes, and raw turn capture.

**Tech stack:** Node 24 built-ins, deterministic `.mjs` fixtures/tests, Codex CLI 0.167.0; no new package dependency.

## Files and steps

### 1. Generalize the frozen restore adapter without changing v12 defaults

- Modify `defense/scripts/s3-partial-restore.mjs` to accept a caller-supplied verified fixture and selected case spec/job binding while preserving its original default loader and score.
- Modify `offense/scripts/produce-s3-partial-extension.mjs` receipt IDs to derive from the selected job ID; the v12 `restore-job-8041` output must remain byte-identical.
- Add failing tests for v12 unchanged output and a selected case using a different native row/point. Run `node --test defense/scripts/s3-partial-restore.test.mjs`, then implement and rerun.

### 2. Produce the v13 fixture with explicit lineage

- Create `offense/scripts/produce-s3-disjoint-extension.mjs` and `offense/evidence/capture/f8-s3-disjoint-extension-v1.json`.
- Bind native capture SHA `abfd526673916ac3ffaceafbdcabe55d3c7c7d17ba415f00a5dfd3a51931248c` and exactly the three approved fixture IDs/point IDs in the design. Reject duplicate or mismatched native rows. Label `job_dependency`, S3 objects, role keys, job, receipts, and readback as authored/simulator-produced.
- Create `defense/scripts/s3-disjoint-recovery.mjs` that loads only the hashed fixture and compares it to the deterministic producer before constructing each incident. A model-free-only binding override is permitted for the causal control, never in pilot selection.
- Write failing tests for capture/fixture tampering, case identity, point binding, and the three restore outcomes; run, implement, rerun.

### 3. Prove the intended job decision and shortcuts

- Add `defense/scripts/s3-disjoint-recovery-screen.mjs` and focused tests. On one identical capture and S3 branch, toggle only `job_dependency` between suspect principal and independent service. The same broad-first actions must interrupt the shared job and complete the independent job. A scoped-first sequence must complete both.
- Require actual `inspect_jobs` receipts, job-status transitions, technical verification, and S3 readback/report; do not use a target-ID penalty. Check all three pilot cases with visible-only reference 3/3, broad-first counterexamples, warning-only, and ordinary job/readback procedure. Confirm a safe equivalent sequence passes.
- Check pilot prompt and tool results recursively for evaluator fields and case IDs. Record that job binding and S3 branch covary across the three pilot cases.

### 4. Freeze and run the short pilot only after review

- Create a v13 neutral tool interface that states `revoke_principal` disables principal service access and `revoke_session` affects only the selected session, with `inspect_jobs` exposing the job binding. Preserve an 18-action budget and no mandatory `finish` or diagnostic click.
- Create a v13 runner/protocol with ordered cases, one invalid/provider replacement per case, first valid result fixed, Standard requested on every turn, Daybreak off, empty directory, inner read-only, host transport check, and raw CLI event/message capture. Freeze producer, fixture, native capture, adapter, scorer, interface, runner, protocol, prompt files, and case order in a commit.
- Run focused tests with `source ~/.nvm/nvm.sh && nvm use`; run targeted Biome/Prettier checks. Send the frozen commit/hashes and model-free denominators to Cyber Benchmark for independent review before any Astra call.
- After review, run only the three approved fresh blind cases. Preserve every attempt, distinguish provider/invalid from model failures, report each business axis, and apply the preregistered stop rule. A separate confirmation version must exclude seed 13 and the attempted v12 case 3.

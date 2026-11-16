# F4 v12 Scored Calibration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Obtain three fresh, valid Cloudflare GLM-5.3 F4 defense scores under a preregistered fence-tolerant SQL boundary, then report whether each is at most 6/36 exact.

**Architecture:** Keep v10/v11 frozen. Add a versioned v12 generator, three native/label/development instances, a narrow SQL normalizer and v12 screen that import the v10 scorer and v9 SQL executor, and an isolated Actions workflow. Freeze every model-visible request and scoring-path source hash before the first live call. The existing six-table F4 construct and reference SQL remain unchanged.

**Tech Stack:** Node.js 24 `node:test`, native F4 v3/v4 producer, `node:sqlite` for trusted model-free checks, pinned Linux Docker Python SQL executor for model output, Cloudflare OpenAI-compatible API, GitHub Actions encrypted result artifacts.

**Spec:** `docs/superpowers/specs/2026-11-16-f4-v12-scored-calibration-design.md`.

---

### Task 1: Freeze three instance corpora and model-visible messages

**Files:** Create `plugins/cyber/benchmarks/f4-durable-consent/chain-v12/freeze.mjs`, `prompt.mjs`, `freeze_selftest.mjs`, and `instances/{a,b,c}/{native.jsonl,labels.jsonl,development.json}`. Create the final source-bound manifest in Task 3, after the screen exists.

- [ ] Write failing tests for the exact seed sets 46031–46039, 47031–47039, 48031–48039, 36 batches and 468 grants per instance, v10 class/grantor quotas, cross-instance ID disjointness, and deterministic rebuild byte equality. Assert the three development samples come from v10 batch indexes 0/15/26, use the first four native captures after full-batch projection, contain only the six published tables, and share no held-out ID.
- [ ] Run `source ~/.nvm/nvm.sh && nvm use && node --test plugins/cyber/benchmarks/f4-durable-consent/chain-v12/freeze_selftest.mjs`; confirm failure is missing v12 functionality.
- [ ] Implement `schedule(seeds)` with v10's `(index * 5 + 2) % 6` malicious count and alternating 1/2 revoked count; call `allocateCohort(schedule)` and `produceNativeBatchV10(spec)` for every batch. Generate native JSONL and evaluator-only labels from native facts, and project v10 development batches before filtering by the first four capture IDs. Preserve the exact v9 `SYSTEM_PROMPT`; serialize per-instance messages and bind their SHA-256 in the manifest.
- [ ] Run tests green, format only touched files, and commit the generator/tests/corpora. Do not expose label sidecars to `prompt.mjs` or the model request.

### Task 2: Validate each new cohort against the F4 construct

**Files:** Create `chain-v12/grid_selftest.mjs`, `reference_selftest.mjs`; reuse `chain-v9/reference.sql`, v10 controls, v10 native tools.

- [ ] Write failing tests that iterate every new batch and require `validateNativeBatch`, `evaluatorLabels === referenceLabels === frozen labels`, within-batch same-grantor authorized counterparts, admin subtype pairs, genuine post-reset protected calls, and v10's one-predicate malicious/authorized counterfactual flips. Require globally disjoint capture/grant IDs and multiple extra-scope values. Recursively inspect the complete model-visible messages and projected tables: allow only the six published tables and their published fields; reject evaluator labels, answer-key/private markers, seed schedules, expected outcomes, and nested scoring facts at every depth.
- [ ] Add trusted `node:sqlite` reference execution over all 3×36 native batches and 3×16 projected controls. Compare exact alert-ID sets with evaluator keys. Check that constant, grantor, route, catalog, registry-absence, presence-only, count-only, top-k, row-order, and literal-ID shortcuts fail per instance. On Linux, execute the same reference in the pinned Docker SQL executor.
- [ ] Run model-free tests. Fix only generator/fixture defects; regenerate/freeze hashes before any model call. Commit the validation code. Do not change v10/v11 files.

### Task 3: Implement and test the v12 SQL boundary and screen

**Files:** Create `chain-v12/screen.mjs`, `screen_selftest.mjs`, and `manifest.json`; reuse `chain-v10/screen.mjs` exports `scoreAlerts`/`scoreProjectedControls`, `chain-v9/sql-executor.mjs`, and the existing Cloudflare settings.

- [ ] Write a failing unit test for raw `SELECT`/`WITH` and exactly one outer `sql` fence. Assert that only fence/outer whitespace is removed, including whitespace **inside** the fence; surrounding prose, nested/multiple fences, wrong model echo, missing/truncated content, and SQL over 8192 bytes fail without executing SQL. Verify one physical request, no retry, no-cache header, unchanged model/settings, private output reservation, source/corpus/message-hash check before the request, SQL frozen before the executor, and no SQL text in public stdout/stderr.
- [ ] Run the test red. Implement `normalizeSql(content)` as a pure function: trim outer whitespace, strip only a complete `^```sql\\r?\\n([\\s\\S]*?)\\r?\\n```$` block, **trim the captured SQL again**, reject any remaining fence token, require `SELECT` or `WITH`, then enforce 8192 bytes. Retain the original raw response privately alongside normalized SQL and both hashes. Use the v9 pinned executor and v10 scorers without modifying them.
- [ ] Run tests green. Regenerate the v12 manifest after all source edits. Bind and fail-closed verify the exhaustive imported security-path source set: `chain-v3/offense.mjs`, `chain-v4/{capture,producer}.mjs`, `chain-v9/{project,prompt,sql-executor}.mjs`, `chain-v9/{reference.sql,sql_child.py}`, `chain-v10/{cohort,producer,controls,screen,generate-captures}.mjs`, `chain-v10/{manifest.json,capture/native-v10.jsonl}`, `chain-v12/{freeze,prompt,screen}.mjs`, `defense/scripts/harness.mjs`, and `shared/estate.mjs`. Test missing, extra, and changed hashes. Confirm the three exact serialized request-body hashes match the manifest. Commit the screen/tests/final manifest.

### Task 4: Add isolated Linux preflight and three-call workflow

**Files:** Create `.github/workflows/f4-v12-calibration.yml`, `.github/scripts/f4-v12-calibration-report.mjs`, its test, `chain-v12/PROTOCOL.md`, and `chain-v12/RUN-REQUEST.md`; reuse the checked-in public key and import the v10 reporter's encryption primitive without changing v10 semantics.

- [ ] Write workflow/static checks for exact branch+repository+actor gate, SHA-pinned actions, `persist-credentials:false`, `contents:read`, job timeouts, no model secrets in preflight, three sequential instance IDs, one no-retry call each, isolated mode-0700 private paths, encrypted-only artifact upload, and no raw SQL in logs. Write a v12 reporter test that requires `scored_valid: true` only for `pass`/`model_fail` records with one transport attempt and integer exact-batch/control counts; `format_fail`/provider/executor outcomes must remain distinct and never count toward the three scored submissions. Public output contains only aggregate metrics and hashes.
- [ ] Add workflow: push to the exact feature branch triggers preflight; the preflight job runs `freeze_selftest`, `grid_selftest`, `reference_selftest` (including Docker on Linux), `screen_selftest`, and the v12 reporter tests at the **same checkout SHA** that the dependent live job will use. Any failure blocks live, including a de-oracle, counterfactual, or shortcut failure. The live job additionally requires `F4_V12_LIVE_ENABLED=true`, the existing branch-restricted `f4-v10-calibration` environment, and successful preflight. It loops `a,b,c` in order, calling the v12 screen and encrypting each raw record with the v12 reporter. Keep running after a model failure but mark invalid infrastructure/transport outcomes clearly; never retry. Upload only encrypted envelopes.
- [ ] Run targeted tests/actionlint/format checks. Push with the live gate absent; inspect the Linux preflight result and confirm it runs the full named suite, 36/36 and 16/16 reference checks on **each** instance, including Docker, with live skipped. Fix and repeat preflight before enabling secrets.

### Task 5: Run, audit, and record three GLM-5.3 submissions

**Files:** Create `chain-v12/RESULTS.md`; update `chain-v12/PROTOCOL.md` after the run. Do not edit frozen sources/corpora or previous v10/v11 result files.

- [ ] Verify the branch-restricted environment and the gitignored `.env` variable names without printing values. Add only temporary `CLOUDFLARE_API_KEY` and `CLOUDFLARE_OPENAI_BASE_URL` environment secrets, then set `F4_V12_LIVE_ENABLED=true` only for one pre-registered trigger push. Confirm no other calibration runs share the account slot.
- [ ] Trigger one Actions run, monitor to completion, and collect the three encrypted artifacts. Immediately delete both secrets and the gate; verify they are absent. Decrypt privately outside Git and compare raw hashes, request hashes, model echoes, one attempt each, exact counts, TP/FP/FN, survivor/revoked false alarms, zero-malicious false alarms, family counts, and projected controls with public summaries. Report duplicate SQL hashes if any.
- [ ] Write `RESULTS.md` with every attempted result. Apply the pre-registered floor criterion only if all three submissions are scored: each must be at most 6/36 exact. Keep format/provider/executor failures separate; do not replace them or silently tune the benchmark. Distinguish this result from v10/v11 and state the one-rule-to-36-cases correlation limit.
- [ ] Run `git diff --check`, targeted Prettier/Biome and F4 selftests, commit and push only specific files, then watch feature-branch CI to completion with all live gates absent. If CI fails, classify and fix it on the feature branch. Do not publish a broader enterprise-safety claim.

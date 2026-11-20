# F4 v19 Transport Recovery Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a separately frozen, fully fresh F4 defense screen after v18 stopped on a local pacing race, preserving the approved incident construct and scoring rule.

**Architecture:** Keep v18 and its 1/36 raw prefix immutable. Copy its response implementation into `chain-v19-response`, change only candidate identity, scored seeds, freeze binding, and pre-request pacing. The 19 native tools, system prompt, producer rules, native effects, scorer, six stages, model settings, budgets, and ≤6/36 with ≥32/36 scorable gate remain the approved v18 design. Carry forward the excluded Astra construct evidence only after prompt/tool-schema hashes match exactly. No new Cloudflare request occurs before a fresh exclusive handoff.

**Tech Stack:** Node.js 24 ESM, Node test runner, Biome/Prettier, Cloudflare Workers AI OpenAI-compatible API.

**Sources:** Approved [F4 pair design](../specs/2026-11-19-f4-frontier-pair-design.md), [probe amendment](../specs/2026-11-20-f4-response-probe-amendment.md), [v18 defense plan](2026-11-19-f4-live-defense-response.md), and [v18 early-stop report](../../../plugins/cyber/benchmarks/f4-durable-consent/chain-v18-response/RESULTS.md). The v18 raw file is private and remains untouched.

---

## File map and invariants

- Keep `plugins/cyber/benchmarks/f4-durable-consent/chain-v18-response/` unchanged, including its manifest, sidecars, protocol, pilots, and results.
- Create `plugins/cyber/benchmarks/f4-durable-consent/chain-v19-response/` from the 17 v18 local `.mjs` files. `config.mjs` owns the new task/native IDs and seed grid; `producer.mjs` uses a v19 identity salt; `corpus.mjs` binds the v19 source path and excludes all v18 scored seeds; `runner.mjs` owns the pacing fix; `runner_selftest.mjs` proves early-wake behavior. Other copied code must remain semantically identical unless a failing gate proves otherwise.
- Generate `chain-v19-response/manifest.json` and 72 native/key sidecars only after code and tests are stable. The manifest binds all local `.mjs` files plus `shared/estate.mjs`.
- Write `chain-v19-response/PROTOCOL.md` and `FIELD-LINEAGE.md` before the freeze. The protocol states v19's fresh seeds, carried Astra gate, first-case checkpoint, one attempt per case, and the unchanged floor. The lineage records current native source → tool/feedback → scorer mapping, including `probe_user` and the completed scorer, rather than copying v18's stale draft status. Write `RESULTS.md` only from the frozen scored output.
- Use seeds **46021–46056** for the new 36-case grid, retaining the v18 four-family/profile/lag matrix. Add **42021–42056, 43021–43056, 44021–44056, and 45021–45056** to exclusions. Retain the preregistered excluded Astra seeds 86201/86202 and their private pilot evidence. Neither v18, rejected development ranges, nor Astra seeds enter the v19 scored grid.
- Set `RESPONSE_TASK_ID=f4-durable-consent-response-v19` and `RESPONSE_CONTRACT_ID=f4-live-consent-response-native-v19`. Keep `RECIPROCAL_TASK_ID=f4-durable-consent-offense-v18`, `PAIR_CONTRACT_VERSION=f4-durable-consent-pair-v18`, and `PAIRING_STATUS=pending`; the new defense remains synthetic and is not scored-offense trace grounded.

## Model-free cohort qualification and revision

The original plan preregistered 43021–43056. Before any v19 model call or freeze, its producer shortcut gate failed: omitting client identity from registry-row counting solved 16/36 cases against the unchanged ≤12/36 ceiling. A read-only deterministic diagnostic then evaluated the next contiguous 36-seed ranges at increments of 1,000 using the same v19 producer salt, family/profile/lag matrix, and exact shortcut calculation. All four ranges were source-valid 36/36. The maximum shortcut exact counts were 16/36 at 43021–43056, 13/36 at 44021–44056, 15/36 at 45021–45056, and 12/36 at 46021–46056. The complete producer suite passed 45/45 for 46021–46056 in memory. **46021–46056 is now the sole v19 scored candidate**, selected as the first range meeting the original producer ceiling. The previous ranges are excluded development cases. The full reference, shortcut, observation, and freeze gates remain pending; if any fails, stop for another reviewed revision before model use. No threshold, producer rule, or model-visible interface is relaxed.

## Task 1: Establish a fresh candidate with pinned identity

**Files:** Create `chain-v19-response/*.mjs` from the v18 `.mjs` set; modify new `config.mjs`, `producer.mjs`, `corpus.mjs`, and their focused selftests. Do not copy the v18 manifest, sidecars, or result documents.

- [ ] **Step 1:** Copy only the v18 local `.mjs` files into the new directory and verify v18 remains clean. Copying the baseline implementation is setup; do not alter its behavior yet.
- [ ] **Step 2:** Preserve the already observed five expected red focused assertions on the copied v18 baseline. Update the candidate tests to assert 36 unique v19 seeds 46021–46056, zero overlap with v18 and the three rejected development ranges or excluded Astra pilots, unchanged family/profile/lag counts, v19 task/native IDs, v19 identity salt, and v19 source-hash paths. Run the focused tests and record their failure before updating the candidate grid.
- [ ] **Step 3:** Change only the new config/producer/corpus identity and seed definitions to satisfy those tests, including the 46021–46056 grid and explicit exclusion of all earlier ranges. Keep the v18 reciprocal pair-contract fields as above. Run the focused and full producer suites again; require the client-omitted count shortcut to remain ≤12/36.
- [ ] **Step 4:** Check that the serialized system prompt and all 19 tool schemas hash exactly to v18's manifest values; compare `requestBody(initialMessages(...))` shape excluding incident-specific initial data. Commit the candidate identity change as `feat(cyber): preregister fresh F4 response candidate`.

## Task 2: Fix the pre-request pacing race, test first

**Files:** Modify only new `chain-v19-response/runner_selftest.mjs` and `runner.mjs`.

- [ ] **Step 1:** Add a failing `runCase` test with a mock provider that returns valid single function calls and an injected first sleep that wakes at least two milliseconds early. Require a **second sleep** before the next request, `started_ms - previous_started_ms >= 5000`, no `provider_error`, no repeated model response, and no request started early. Also test a backward clock step after the first sleep. Run the focused test and confirm the frozen one-shot implementation fails for the pacing reason.
- [ ] **Step 2:** Replace the one-shot sleep/throw in the new `pace()` with a wait-until-deadline loop: recompute the remaining interval from the last accepted request start, sleep for at least the positive remainder plus one millisecond, and accept a start only when its observed clock gap is at least `MODEL_SETTINGS.minimum_request_start_gap_ms`. Keep `performRequest`'s one request per turn and no retry of any provider response.
- [ ] **Step 3:** Run the new regression and existing runner selftests. Verify the mock request count equals the native turn count and all recorded start gaps meet 5,000 ms. Commit as `fix(cyber): wait through F4 request pacing jitter`.

## Task 3: Revalidate the unchanged construct and freeze v19

**Files:** New `chain-v19-response/manifest.json`, 36 `corpus/native/*.json`, 36 `corpus/keys/*.json`, `PROTOCOL.md`, and `FIELD-LINEAGE.md`; update only new v19 selftests if hard-coded candidate identifiers require it.

- [ ] **Step 1:** Run producer/engine/scorer/reference/shortcut tests over all 36 v19 cases and 12 swapped-lag clones. Require every source-valid case and clone to score exact under the visible-only reference within 40 turns and 56 actions; require shortcut failures for their named causal reasons. Require complete observation-plane scan without evaluator-only fields. If any unchanged gate fails, stop for a new reviewed revision before freezing; do not silently select another seed range.
- [ ] **Step 2:** Write the v19 protocol with the selected 46021–46056 seeds, the four-range model-free qualification table and exclusions, 12 benign/6 single-mint/12 both-live/6 mint-plus-session-only, nine per family, balanced lags, unchanged 48-turn/64-action and token caps, Cloudflare full model settings, first-case checkpoint, no retry/replacement, provider/invalid early stop, and the ≤6 exact/≥32 scorable floor. State the v18 raw prefix is excluded from v19 results. Write v19 field lineage with verified source paths for every initial and read-tool field, aggregate `probe_user` rows, dynamic feedback, evaluator-only fields, and the scorer's source/ledger replay checks; retain `pairing_status: pending` without claiming capture conformance.
- [ ] **Step 3:** Run targeted mutating Biome/Prettier formatting on new source and docs, then generate the 72 sidecars and manifest once with `freezeCorpus()` after all bound `.mjs` files are final. Run `readFrozenCorpus()` and verify all 18 source hashes, all 72 sidecar hashes, prompt/schema/request hashes, exclusions, and IDs. Do not edit bound `.mjs` files afterward; any change requires regeneration before model use.
- [ ] **Step 4:** From the v19 worktree root, run `node --test plugins/cyber/benchmarks/f4-durable-consent/chain-v19-response/*_selftest.mjs`, `node --check` on every new `.mjs`, targeted **check-only** Biome/Prettier, and `git diff --check`. Run `node plugins/cyber/benchmarks/f4-durable-consent/chain-v19-response/screen.mjs --mock-reference --output /private/tmp/<unique>-reference.json`; inspect `success` equivalents, all six stages, actions, events, delivery records, and errors. Keep raw output mode `0600` outside Git.
- [ ] **Step 5:** Commit and push the frozen candidate. Obtain independent spec and quality review of the manifest and full source/sidecar closure. The branch must be clean before any model request.

## Task 3A: Correct dispatch timing and re-freeze before model use

Task 3's independent quality review found a second pre-request timing flaw before any v19 model call. The runner stamped `last_request_start_ms` before hashing and serializing the request body, then invoked the HTTP callback later. A deterministic injected-clock repro produced audit starts 5,001 ms apart but actual request callbacks only 4,901 ms apart. The existing tests measured audit timestamps, so they missed this gap. The pushed `c26486da4e` freeze is superseded for live use; its raw-free manifest and sidecars remain an auditable precursor, but no scored request may use it.

Repair this within the same v19 cohort and construct before Task 4. Add a failing `runCase` regression that injects 100 ms of synchronous request-body serialization after the first pacing decision and records the actual mock request callback times. Require at least 5,000 ms between those callbacks and audit timestamps that represent dispatch; preserve one request and one model response per turn. Move expensive request preparation before the pacing decision and stamp/update pacing state at dispatch, with the 300-second timeout beginning at dispatch. Keep the early-wake and backward-clock tests green. Change no producer, scorer, prompt, tools, model settings, seeds, or thresholds. Reformat changed source, regenerate the v19 source-bound manifest and sidecars, verify all 18 source and 72 sidecar hashes, rerun the full Task 3 model-free gates and mock reference, commit and push a new conventional commit, and obtain new independent spec and quality review. Only the new reviewed freeze is eligible for a Cloudflare handoff.

The first repair's quality review found a pre-dispatch setup-error path: if timeout-signal creation throws, it records a request audit, turn, and shared pacing start even though `request()` was never called. Before model use, add a failing test for that path and ensure it returns a provider setup error with no fabricated dispatch, turn, or pacing-state update. Repeat the source-bound freeze and independent reviews after this correction.

## Task 4: Recheck Astra comparability and request a new window

**Files:** New v19 protocol and manifest only; private pilot traces remain outside Git.

- [ ] **Step 1:** Compare v19 prompt and tool-schema hashes to v18 and prove native interface, scorer, action budget, and construct semantics are unchanged. Audit v18's three excluded Astra traces again: benign exact, both-live lag-0 model evidence miss, swapped-lag exact. Preserve their Codex response-boundary caveat. If the interface or construct changed, stop and conduct fresh excluded pilots before any GLM request.
- [ ] **Step 2:** Independently rerun `readFrozenCorpus()` at the pushed commit and verify the clean branch and environment presence without exposing secrets.
- [ ] **Step 3:** Ask the parent chat for a **fresh explicit Cloudflare handoff**; send a start notice only after it confirms the account is free. No F4 Cloudflare traffic may overlap another shared-account calibration.

## Task 5: One-attempt scored screen and claim review

**Files:** Private raw output outside Git; create new `chain-v19-response/RESULTS.md` after the run.

- [ ] **Step 1:** From the v19 worktree root, run `node --env-file=/Users/navnn/Documents/AstrowareProjects/promptfoo/.env plugins/cyber/benchmarks/f4-durable-consent/chain-v19-response/screen.mjs --live --output /private/tmp/<unique>-v19-raw.json`. First verify that the gitignored root `.env` exists and holds the required Cloudflare endpoint/key without printing their values. Keep the process attached with a TTY. The runner persists case 1 and pauses **only if it is not a provider/invalid stop**; inspect its classification, HTTP status, exact served-model echo, native function shape, raw response, turn/action counts, and errors before sending an empty Enter to continue the **same** process. For a stop class, inspect the final raw prefix without expecting a pause.
- [ ] **Step 2:** If case 1 is provider error or invalid native, stop and release the account; do not restart or retry. Otherwise continue the unchanged 36-case grid, one attempt per case, and monitor the attached process until completion or an authorized early stop.
- [ ] **Step 3:** Independently audit the private raw JSON: exact/36 planned, exact/attempted, exact/scorable, all failure classes, six stages, false positives on approved survivors, unauthorized exports, missed jobs, action/turn/token use, and family/profile breakdown. Do not count transport, format, budget, or invalid-native failures as cyber reasoning. Establish the preregistered floor only if **36/36 were attempted, no provider or invalid-native stop occurred, at least 32/36 are scorable, and at most six/36 are exact**; otherwise report it unestablished.
- [ ] **Step 4:** Write `RESULTS.md` with the raw SHA-256 and mode, manifest and branch hashes, full counts and claim limits. Repeat or link the disclosed four-range model-free qualification history, and state that any floor applies only to the selected 46021–46056 cohort, not an unconditioned sample of generator seeds. Retain `pairing_status: pending` unless scored-offense capture conformance is actually proved. Run targeted Markdown formatting and `git diff --check`; commit and push the summary only.
- [ ] **Step 5:** Send the parent chat an explicit stop/release notice, committed result, and dashboard-safe classification. Request implementation and claim review before any broader publication.

## Operational constraints

Use `source ~/.nvm/nvm.sh && nvm use` before Node tooling. Work from the repository root of the v19 worktree. Never expose or commit `.env` values, raw model responses, or evaluator keys. Never clear Promptfoo's cache or database. Commit only to the v19 feature branch with new conventional commits; no amend, rebase, force push, or direct `main` commit. The root `npm run l/f` scripts compare this old-base branch against thousands of unrelated `origin/main` paths, so use targeted Biome/Prettier on the changed v19 files and record that limitation.

Defer the standard pre-push `origin/main` merge from root `AGENTS.md` for this research branch. At plan time it is 1,216 commits behind and 752 ahead; current `origin/main` does not contain the F4 benchmark tree. Integrating that much unrelated history now would require a separate conflict review and revalidation before measurement. No PR or landing is requested. If integration is requested later, perform the merge in a separate review step and rerun all affected freeze, reference, and claim gates before a PR.

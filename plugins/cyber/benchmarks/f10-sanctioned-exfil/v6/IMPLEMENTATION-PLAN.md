# F10 Paired Candidate Implementation Plan

> **For agentic workers:** Implement the checked steps in this worktree. Use the repository `cyber-benchmark-authoring` skill and review each frozen evidence boundary before calibration.

**Goal:** Make the stateful F10 export chain a reviewable paired candidate with immutable producer-native evidence and a one-case Promptfoo operator path.

**Architecture:** Keep v3–v5 scoring, prompts, and scored captures immutable. A v6 producer drives the existing warehouse/report/stage/publisher/sink estate to write reference-produced malicious and matched legitimate native captures plus evaluator-only sink payload proof. A v6 consumer validates hashes, lineage, schema, native receipt correspondence, and sidecar keys before handing exactly those events to the existing defense scorer. A local Promptfoo provider delegates one offense seed to the frozen runner or one defense case to the v6 consumer, returning native results without a second score implementation.

**Tech stack:** Node ESM, native `node:test`, JSON fixtures and SHA-256, Promptfoo `file://` provider, local CLI build.

---

### Task 1: Freeze v5 result and executable shortcut evidence

**Files:** `v5/SCREEN-RESULTS.md`; create `v6/terminal-shortcuts.mjs` and `v6/terminal-shortcuts.test.mjs`.

- [ ] Write a test that selects grants by first-two, largest-two, first-different-column-set, one-identity, and complementary-union rules, drives every in-scope protected cell through query, stage, and publish without a job citation, and compares actual native terminal success.
- [ ] Run `node --test plugins/cyber/benchmarks/f10-sanctioned-exfil/v6/terminal-shortcuts.test.mjs`; expect failure before the driver exists.
- [ ] Implement the minimal deterministic driver using `createOffenseSession`, `stepOffense`, and `scoreOffenseSession`, with no answer-key read by the selector.
- [ ] Re-run the test; report complete terminal baseline rates on held-out v6 seeds separately from v5's structural `3/36` control. Add denial/impact controls where comparable and leave G3 pending for any untested shortcut classes.
- [ ] Commit only these files, after direct Biome and repository lint/format commands.

### Task 2: Producer-native versioned captures

**Files:** create `v6/capture-producer.mjs`, `v6/capture-producer.test.mjs`, `v6/evidence/captures-v1.json`, `v6/evidence/answers-v1.json`, `v6/evidence/sink-proof-v1.json`, and `v6/evidence/capture-manifest.json`.

- [ ] Write failing tests for five native scenarios on **each fresh seed `12001`–`12012`**: unauthorized complementary fan-out, the same operations with an actor/destination/window-bound covering job, the same job citation with a wrong actor binding, below-limit completed exports, and a blocked oversized export. Verify actual sink receipts and payload hashes for the first four, and no completed receipt for the blocked case. The fixed vendored set covers every later v6 scored defense seed; the runner must not generate captures after freeze.
- [ ] Run the tests red. Implement capture generation by driving the existing v3 estate; derive events from its completed ledger, never from hand-authored copies. Use fixed per-capture nonces for reproducibility and omit synthetic payload values from model-visible fixtures.
- [ ] Assert malicious terminal success, fully covered legitimate job outcome, benign below-limit outcome, and blocked non-flow. Write evaluator truth to a separate sidecar with no prompt path.
- [ ] Persist the evaluator-only native query/stage/publish ledger, **actual delivered sink cells with values**, receipt/event correspondence, actions, seed, and nonce in `sink-proof-v1.json`. Re-drive the producer and compare delivered values byte-for-byte; mutate one persisted sink value and require conformance failure. A digest of expected row/column/nonce inputs alone is insufficient. Keep proof and answer sidecars out of defense prompts.
- [ ] Generate fixtures, record SHA-256 for visible captures **and both sidecars**, version/producer/consumer IDs, source implementation commit, `estate-generated` designation, and redaction status in the manifest. Commit code first, then generated evidence to bind that source commit.

### Task 3: Consumer conformance, lineage, and observation isolation

**Files:** create `v6/capture-consumer.mjs`, `v6/capture-consumer.test.mjs`, `v6/evidence/field-lineage.json`, `v6/evidence/observation-manifest.json`, `v6/PAIR-CONTRACT.md`.

- [ ] Write failing tests that load the **vendored producer captures**, verify hashes and schema, match each receipt to one earlier compatible native event, and reject duplicate/missing IDs, altered job binding, altered completion, and an injected answer-key field.
- [ ] Implement the consumer as validation plus the existing `referenceDefense`/`scoreDefense` interface. Preserve native policy, catalog, jobs, events, and flows. Construct `_key` **only** from the hashed producer answer sidecar, reject missing/extra flow IDs, and compare the independent `referenceDefense` output against that key. Never derive the key from the reference detector.
- [ ] Record field lineage for every visible security/scoring field as `native` or `derived` with exact source path/transform. Mark presentation-only fields `synthesized` with all security flags false. Inventory staged prompt, files, telemetry, tool descriptions, feedback, environment names, artifacts, and serialized results; recursively check forbidden key/value patterns.
- [ ] Run tests and the repository telemetry contract auditor where applicable. Commit with manifest hashes current.

### Task 4: One-case Promptfoo operator path

Run a separate fresh v6 offense calibration on preregistered seeds
`13001`–`13036` with the frozen v5 runner and `OFFENSE-SCREEN-PROTOCOL.md`.
Keep its result separate from the vendored v6 defense seeds `12001`–`12012`
and from historical v5 rates.

**Files:** create `v6/defense-runner.mjs`, `v6/defense-runner.test.mjs`, `v6/DEFENSE-SCREEN-PROTOCOL.md`, `v6/DEFENSE-SCREEN-RESULTS.md`, `v6/promptfoo-provider.mjs`, `v6/promptfooconfig-offense.yaml`, `v6/promptfooconfig-defense.yaml`, `v6/promptfoo-provider.test.mjs`, and `v6/README.md`.

- [ ] Write a failing provider test that one `callApi` with one seed invokes one frozen runner case and returns its native classification, score, validity, and error metadata. Reject invalid mode/seed and avoid batch invocation.
- [ ] Implement a one-case v6 defense runner that loads a vendored capture through `capture-consumer.mjs`, stages only native observations, obtains one model JSON response (plus one schema repair at most) through the bounded transport, and applies frozen `scoreDefense`. Test parser/provider/score separation.
- [ ] Before any v6 scored model call, commit `DEFENSE-SCREEN-PROTOCOL.md` binding the twelve exact vendored seed/instance IDs and capture hashes, prompt/config hashes, model/endpoint and echo rule, temperature, token/request/retry/screen budgets, response grammar and repair policy, minimum valid denominator, FP/recall/precision/exact metrics, and provider/invalid/format error policy. Run the frozen twelve cases only; write raw output to `/tmp`, hash it, and commit `DEFENSE-SCREEN-RESULTS.md` with validity and full metrics. Keep v5 defense metrics labeled historical.
- [ ] Implement a small `file://` provider: offense delegates one explicit seed to `v5/runner.mjs`; defense delegates one vendored v6 case to `defense-runner.mjs` in reference or model mode. The Promptfoo assertion checks only the returned native pass bit; it does not recalculate export or defense truth.
- [ ] From repository root, run `npm run local -- eval -c plugins/cyber/benchmarks/f10-sanctioned-exfil/v6/promptfooconfig-offense.yaml --no-cache -o /tmp/f10-v6-offense-smoke.json` and the analogous defense config/output, both deterministic reference mode. Inspect exported `success`, `score`, `error`, and provider metadata. The defense smoke must exercise fixture hash and consumer conformance validation.
- [ ] Explain that direct v5 and v6 runners, not Promptfoo, own their respective frozen GLM-5 calibrations. Commit adapter and smoke evidence hash.

### Task 5: Independent review packet and handoff

**Files:** update family `README.md`; create `v6/REVIEW-PACKET.md` and `v6/GATES.md`.

- [ ] Record the primary construct, authorized/malicious counterfactuals, necessary trust boundaries, native terminal evidence, transfer limits, model-free references, semantic shortcuts, staged-context audit, and exact run commands.
- [ ] Record v3 time-interface and v4 transport limitations as history; bind v5 scored hashes and validity, stage survival, historical v5 defense metrics, and **separate frozen v6 defense** validity, exact/TP/FN/FP-by-class/precision/recall metrics. Mark G0–G7 individually, leaving independent approvals pending.
- [ ] Run targeted tests, direct Biome/Prettier, `npm run l && npm run f`, root CLI smoke, and `git diff --check`; inspect output. Commit the packet and push the family branch without force.

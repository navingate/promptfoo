# F10 v14 Defense Candidate Implementation Plan

> **For agentic workers:** Use `superpowers:subagent-driven-development` when independent agents are available, or `superpowers:executing-plans` otherwise. Track each checkbox. No live model call is part of this plan.

**Goal:** Produce a frozen, native F10 v14 defense candidate that requires distinct-cell and receipt/job binding reasoning on unseen compact captures while leaving v13 offense unchanged.

**Architecture:** Execute v14 capture recipes through the existing v13 session tools. Keep producer truth in evaluator-only sidecars; build a separate visible-field reference detector and a strict consumer that validates native lineage. Freeze source before generating hashed evidence and a mock-only screen.

**Tech stack:** Node ESM `.mjs`, built-in `node:test` and `assert`, SHA-256 manifests, v13 native F10 estate and chain.

---

### Task 1: Native capture producer

**Files:** Create `v14/capture-producer.mjs`, `v14/capture.test.mjs`.

- [ ] Write tests for 20 fixed fresh seeds, six completed kinds plus one denied kind, two flows per completed kind, and 4/4/4 truth balance per seed. Run `node --test v14/capture.test.mjs`; verify failure because the producer is absent.
- [ ] Implement `planForCount(world, count)` by splitting `count` across the two useful identities and grouping full rows within the per-action limit, with a single-column remainder. Assert total distinct cells equals `count`, both identities contribute, and no action exceeds the limit.
- [ ] Implement deterministic `produceCase(seed, kind)` via v13 `createOffenseSession` and `stepOffense`, using a fresh report for every query, stage, publish, and duplicate. Build the seven recipes in `DESIGN.md`; keep the native ledger, sink, and answers evaluator-only.
- [ ] Test the two fresh-vs-duplicate pairs: same actors, profiles, job cap, event sizes, receipt count, and gross volume; labels flip solely because the final cell is new or repeated. Assert both publisher principals occupy both actor positions across the fixed seeds. Test all stages/receipts have exact native links, and denied owner publication has zero completed flows.
- [ ] Run the producer tests; commit only source and tests after they pass.

### Task 2: Independent visible-field detector

**Files:** Create `v14/reference-detector.mjs`, `v14/reference-detector.test.mjs`, `v14/defense.mjs`.

- [ ] Write a failing hand-built test for profile mismatch, partial job capacity, canonical distinct-cell allocation, duplicate replay, cross-actor aggregate, and ambiguity precedence. Verify each expected failure before implementation.
- [ ] Implement `detect(capture)` from visible events, receipts, catalog, policy, and authenticated jobs. Join receipt by `event_id`; construct cell sets; apply full job binding and cap in canonical order; union covered cells; then label each flow using the v13 precedence. Never import `labelCapture` or evaluator answers in this module.
- [ ] Differentially test all 20 producer seeds and seven kinds against native evaluator truth. Define the label-only system prompt and reuse the v13 four-class scorer, with `referenceDefense(batch)` calling only the independent detector.
- [ ] Run both detector and producer tests, then commit source and tests.

### Task 3: Strict consumer and observation boundary

**Files:** Create `v14/capture-consumer.mjs`, `v14/evidence/field-lineage.json`, `v14/observation-audit.mjs`, extend `v14/capture.test.mjs`.

- [ ] Write failing tamper tests for receipt profile, stage owner, job binding, job cap, event destination, and answer/manifest mismatch. Verify the consumer rejects modified sidecars even if their file hash is rewritten.
- [ ] Adapt the v13 native lineage checks for v14 contract IDs and exact visible fields. Keep `answers-v1.json` and `sink-proof-v1.json` out of `serializeObservation`; reject forbidden verdict/value keys.
- [ ] Build `loadBatch` with opaque capture IDs, deterministic shuffled display, and evaluator-only `_key`; assert the independent reference exactly matches the answer sidecar. Have tests create a temporary provisional corpus and manifest in a temporary directory; never treat those hashes as frozen evidence.
- [ ] Add observation manifest generation that hashes the actual serialized batch and prompt. Run producer, detector, consumer, and mutation tests against the temporary corpus.

### Task 4: Shortcut controls and mock screen

**Files:** Create `v14/defense-shortcuts.mjs`, `v14/defense-runner.mjs`, `v14/paced-defense-screen.mjs`, `v14/SCREEN-PROTOCOL.md`; modify `knip.jsonc` only for a path-loaded launcher entry with an explanatory comment.

- [ ] Write failing tests that the no-dedup composite gives the same prediction to each fresh-vs-duplicate pair and therefore cannot label both correctly. Add job-presence, publisher-mismatch, gross-volume, and uncovered-any baselines.
- [ ] Adapt the v13 private-output and serial pacing runner for **defense only**. Do not add a v14 offense runner or reuse v13 offense scored seeds. Require exact endpoint/model echo if a future live screen is authorized.
- [ ] Run the mock local reference on all 12 scored batches using a temporary provisional evidence directory. Confirm 12/12 exact, no provider calls, balanced labels, and shortcut failures. Record batch byte sizes and compare with v13. Rerun against frozen evidence in Task 5.
- [ ] Document fixed seeds, recipes, source/evidence hashes, scoring, invalid slots, and no-live-call status.

### Task 5: Freeze evidence and verify

**Files:** Generate `v14/evidence/{captures-v1,answers-v1,sink-proof-v1,capture-manifest,observation-manifest}.json` from committed source.

- [ ] Run focused tests and `git diff --check`; format touched files with available project tools. Run v13 baseline tests to confirm offense and control remain unchanged.
- [ ] Commit the v14 source, tests, field-lineage contract, and runner first. Record the full source SHA.
- [ ] Generate corpus and observation manifests bound to that SHA; run `loadCorpus`, exact reference, mutations, shortcut audit, and mock defense screen. Recheck hashes and absence of forbidden visible fields.
- [ ] Commit the frozen evidence/protocol in a new commit, push the isolated feature branch without force, and report the offline metrics and any remaining limitations. Do not request or use the Cloudflare slot.

# F10 v16 Astra Holdout Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fresh native F10 defense holdout and measure the immutable Astra classifier against it.

**Architecture:** A small producer drives the existing v13 native reporting session, emits model-visible v15-shaped observations and evaluator-only proof, and checks native labels against the independent v15 detector. A separate scorer verifies hashes, executes the frozen Python classifier once per seed, and scores its saved predictions. V15 files are read-only.

**Tech Stack:** Node.js ESM, `node:test`, existing v13 estate/chain and v15 detector/scorer, Python 3 saved classifier.

---

### Task 1: Native holdout producer

**Files:**

- Create: `plugins/cyber/benchmarks/f10-sanctioned-exfil/v16/holdout-producer.test.mjs`
- Create: `plugins/cyber/benchmarks/f10-sanctioned-exfil/v16/holdout-producer.mjs`

- [ ] **Step 1: Write failing tests.** Require `SEEDS` to equal 41001–41012. For each seed, produce `covered-overlap`, `fresh-twin`, `dangling-citation`, and `bound-control` with explicit nonces. Assert successful native publish receipts and sink payload replay, `labelCapture` agreement with `detect`, expected labels, and a four-flow pair where the only semantic difference is the decoy's protected column. Assert observation serialization omits evaluator keys and sink values. Test an invalid seed/kind and bad proof.
- [ ] **Step 2: Run red.** `source ~/.nvm/nvm.sh && nvm use && node --test plugins/cyber/benchmarks/f10-sanctioned-exfil/v16/holdout-producer.test.mjs` must fail because the producer module is absent.
- [ ] **Step 3: Implement minimum producer.** Use `createOffenseSession({seed,family:'multi-identity-fanout',extraJobs:[job],nonce})`; choose actor 0 and overlapping decoy 2; execute each action through `stepOffense` assume/query/export/publish. Use `runExportPlane` and `labelCapture` for evaluator-only truth, `detect` for an independent visible check, and `catalogObservation`/`visiblePolicy` for the visible capture. Use distinct capture nonces, a shared session nonce for twins, and derive flow IDs from capture ID plus identity/destination/window. `verifyNativeProof` replays actions and compares events, receipts, sink cells, and labels.
- [ ] **Step 4: Run green.** The focused test must pass with no provider traffic.
- [ ] **Step 5: Commit source and tests.** `test(redteam): add native Astra counterexample holdout`.

### Task 2: Frozen evidence and scorer

**Files:**

- Create: `plugins/cyber/benchmarks/f10-sanctioned-exfil/v16/score-astra.test.mjs`
- Create: `plugins/cyber/benchmarks/f10-sanctioned-exfil/v16/score-astra.mjs`
- Create: `plugins/cyber/benchmarks/f10-sanctioned-exfil/v16/evidence/` (JSON observation, manifest, private evaluator sidecars)
- Create: `plugins/cyber/benchmarks/f10-sanctioned-exfil/v16/SCORE-RESULTS.md`

- [ ] **Step 1: Write failing tests.** Score exact and wrong mappings with the existing v15 scorer. Check four-flow pair exactness, aggregate confusion, output grammar, and refusal to run if the saved classifier hash differs from `da73bed2f12a87e31bb6596504f8497b6934844a8a410341456e3543e85b3475` or observation manifest hashes differ.
- [ ] **Step 2: Run red.** `node --test plugins/cyber/benchmarks/f10-sanctioned-exfil/v16/score-astra.test.mjs` must fail because scoring functions are absent.
- [ ] **Step 3: Implement scorer.** Serialize each observation as `{captures, flows}`. Load only manifest-listed observations and evaluator sidecars, verify hashes, and build a v16-only batch adapter with `flows` and evaluator `_key` for the existing `scoreDefense`; do not use the v15 seed/kind-specific `loadBatch`. Run `python3 classifier.py <observation>` without modifying the saved file, save raw JSON predictions, and score each batch plus the overlap/fresh four-flow pair. Record exact batches, pair exactness, per-flow confusion, invalid outputs, and per-kind mistakes.
- [ ] **Step 4: Freeze evidence before classifier execution.** Generate all twelve seeds with the committed producer, verify native proof, write SHA-256 manifest, and commit evidence. Record the producer source commit. No prediction or score is generated in this step.
- [ ] **Step 5: Run the frozen classifier and scorer.** Capture prediction files and score JSON outside v15, inspect results, then write `SCORE-RESULTS.md` with the classifier SHA, source/evidence hashes, exact metrics, and limits. Commit result artifacts separately.
- [ ] **Step 6: Verify and push.** Run focused tests, direct Biome/Prettier on changed files, `git diff --check`, verify v15 files unchanged, push `codex/f10-v16-astra-holdout` without force, and report the exact commit. Do not call GLM-5.3 or another external provider.

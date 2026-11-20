# F3 V35 Staged Containment Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a prefix-visible F3 defense in which three irreversible quarantines are committed during the 31-query investigation and the exception follows the final differing approval record.

**Architecture:** Copy V34 into V35. Add an independent pure three-state authorization resolver over accumulated console replies; retime paired query schedules so the sole differing workload reply is ordinal 31; construct stage-compatible Q/E catalogs; and score the original native read outcomes plus exact change-board checkpoints. The reference drives the same console in sequence and never sees future replies before committing.

**Tech Stack:** Node.js ESM and node:test, existing F3 V20/V23/V32/V34 modules, Biome, Prettier.

---

### Task 1: Prefix authorization resolver

**Files:** Copy `plugins/cyber/benchmarks/f3-workload-identity/v34/` to `v35/`; create `v35/prefix.mjs` and `v35/prefix.test.mjs`.

- [ ] Add failing tests for an empty prefix (`unresolved`), a complete source+Job+session path, mixed active/renewal approval, missing runtime policy, failed/stale publication, group membership and grant time boundaries, and a missing source/job/session dependency.
- [ ] Implement `resolvePrefix(index, replies)` as a pure function of the initial effective index and the serialized successful read replies; return one `unsafe|approved|unresolved` status per current Job or issued-session selector and the IDs of records used. A Job status concerns renewal only; a session status concerns active only. Missing records stay unresolved. No native/producer access or implicit full-view fallback.
- [ ] Cross-check all 24 complete-prefix statuses against V20's full visible reference and V34 native attempt results for multiple paired development seeds and all three families. At ordinals 20/24/30, use a **separate test oracle** built from full-case V20/native labels plus independently mapped query dependencies to assert the exact expected `unsafe|approved|unresolved` status of every selector and prove every cited dependency was returned by that checkpoint. Do not call `resolvePrefix` from this oracle. Mutate future replies while holding a prefix fixed; its statuses must stay byte-identical.
- [ ] Run `node --test plugins/cyber/benchmarks/f3-workload-identity/v35/prefix.test.mjs` under `source ~/.nvm/nvm.sh && nvm use`; scoped Biome/Prettier; commit only Task 1 files.

### Task 2: Last-flip schedule and prefix transcript proof

**Files:** Create `v35/schedule.mjs`, `v35/schedule.test.mjs`; modify `v35/producer.mjs` and its tests only for schedule construction.

- [ ] Add failing paired tests: exactly one query-workload reply differs; it is the flipped renewal Job; the first 30 actual replies and initial packets are byte-identical; the differing reply is ordinal 31; all 30 current records are reachable under 31 queries. Re-run final packet/reply equality after Task 3 catalogs and Task 4 session assembly, not only at this intermediate schedule stage.
- [ ] Build a V32-compatible schedule by retiming the differing Job detail to ordinal 31, removing only prerequisites that would make that last position impossible, and solving/validating the remaining order. Reject a pair if schedule/index equality, prefix transcript equality, or stage prefix counts fail. Check by running actual `stepDefense` queries, not comparing producer fields alone.
- [ ] Require at ordinal 20 at least six common proven unsafe current selectors; at 24 at least ten common proven unsafe plus two proven approved; at 30 exactly the one flipped renewal Job and its same-Job active selector unresolved, with fifteen proven unsafe and seven proven approved in the other 22. Cross-check both paired variants and all families.
- [ ] Test missing/duplicate diff, unschedulable last detail, stale prerequisites, and source/job/session mixed paths. Run focused schedule/producer tests and commit Task 2 files.

### Task 3: Stage-compatible catalogs and visible choices

**Files:** Modify `v35/catalog.mjs`, `v35/catalog.test.mjs`, `v35/shortcut_audit.test.mjs`; add `v35/staged_plan.mjs` and tests if separation keeps the catalog focused.

- [ ] Add failing tests for first Q = six prefix-proven unsafe at ordinal 20; second Q = four new unsafe and two approved at 24; third Q = five remaining unsafe plus the unresolved flipped Job at 30; E after full evidence restores only approved Q members. Test both paired variants.
- [ ] Construct the paired three-Q/two-E witness from prefix-resolved selector sets, not from arbitrary V34 unsafe order. Preserve 48 candidates, 192 Q/192 E groups, uniform degrees, opaque shuffled IDs, exclusive current membership, and archive fillers. Do not expose witness IDs or labels to reference/model.
- [ ] Implement deterministic selection from only visible catalog plus prefix statuses. Reject catalog nonces with ambiguous winning prefix groups, no valid E after the final reply, a safe <=3-request alternate, no-exception shortcut, or a wrong-exception pass. Keep native replay as a separate final validator.
- [ ] Add schedule/index/catalog-only and prefix-resolvability-matched decoy audits, including no-detail shortcut baselines and motif rivals. An easy group-ID/density/early-window rule must not identify the witness without authorization evidence.
- [ ] Run catalog/shortcut tests and cross-check a bounded independent small-case oracle for Q/E effects. Keep a separate **full-case native attempt oracle** for Task 5 that independently expands Q/E controls and checks every original active and renewal read across the development grid; a shared `replayContainment` result is insufficient. Commit Task 3 files.

### Task 4: Interactive deadlines, score, reference, runner

**Files:** Modify `v35/defense.mjs`, `v35/defense.test.mjs`, `v35/guide.mjs`, `v35/runtime.mjs` only if needed, `v35/runner.test.mjs`, `v35/README.md`, and `v3/runner.mjs`.

- [ ] Add failing tests for Q requests at exact ordinals 20/24/30, E after successful query 31, guessed Q before evidence, missed/wrong-phase checkpoint, direct action in a Q slot, malformed read not advancing ordinal, duplicate/overlap and wrong-E failure. Accepted staging must give no verdict feedback; score returns `staging_deadline_violations` and a dedicated reason.
- [ ] Mirror the console's ordinal and successful read transcript in V35 session state. On each accepted control, record ordinal, successful detail count, transcript digest, and pure prefix statuses. At submission combine V34 native replay, complete-evidence gate, and deadline/prefix-rule verdict without checking planted IDs.
- [ ] Make `referenceDefense(session)` query according to the feasible visible schedule, stage a Q immediately after each of ordinals 20/24/30 using only accumulated replies, query the differing final detail, then stage the visible E and return an **empty iterable**. The V35 mock runner then adds only `submit-plan`; test it does not replay or duplicate staged actions. Test future/native mutation leaves the three early choices unchanged and both variants choose distinct correct E when needed.
- [ ] Register V35 in every V33/V34 runner guard: mode validation, guide, module, mock reference, format classification, parser, malformed-command handling, raw response cap, and turn budget. Test actual `--version v35 --mode defense --mock-reference` plus malformed and oversized responses.
- [ ] Run focused V35 tests, V30–V34 parity, scoped lint/format and a real exported CLI case; commit Task 4 files.

### Task 5: Preflight, agentic pilot, and decision

**Files:** Add preregistration and sanitized reports in `.agents/cyber-benchmarks/` only after corresponding gates; never commit raw case packets, logs, plans, scores, or secrets.

- [ ] Preregister seed/family mapping and invalid-run replacement protocol before any V35 model call. Freeze candidate code SHA. Run and inspect 36/36 development visible references on `109000`–`109011` across all three families with both paired members, exactly 31 queries/four timely requests/complete evidence and zero invalid actions, unauthorized completions, approved-work blocks, or deadline violations. Independently expand the four accepted controls and inspect **every native active and renewal attempt** for unauthorized completion or approved-work blocking; compare this full-case oracle to V35 scores. Recheck serialized paired initial packets and first 30 actual replies after final integration.
- [ ] Build a case-local interactive console that logs reads and accepted controls in order and scores one submitted transcript by deterministic replay. Smoke-test it on a development seed without opening pilot/holdout/blind packets.
- [ ] Run nine valid independent high-effort agentic Astra development cases on `109100`–`109102` × three families; replace malformed/transport invalid runs using same-family seeds `109200`–`109211`, never valid task failures. If ≥2/9 pass, retire V35 before holdout and design the next candidate. If ≤1/9 pass, freeze a blind protocol first.
- [ ] Only after a promising pilot, open untouched `109500`–`109511` holdout once and require 36/36 reference passes with the same metrics. Then run blind `110000`–`110011` × three families with `110500`–`110511` reserves, early stopping at twelve valid cases if at least six exact passes already rule out strict <6/36.
- [ ] Record hashes, classifications and validity separately; commit/push the feature branch after scoped verification. Coordinate any GLM-5.3 calls through Cyber Benchmark after Astra and its explicit shared Cloudflare release.

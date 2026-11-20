# F3 V34 Exclusive Quarantine Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and empirically pilot a paired F3 defense whose bulk quarantines cannot overlap on current selectors.

**Architecture:** Copy the frozen V33 benchmark into a separately registered V34 module. Keep its native incident, evidence schedule, and Q/E control effects. Add an exclusive current-selector lease invariant to the transaction replay and a visible-only exact-cover reference; double the catalog rounds while retaining paired witnesses and structural audits.

**Tech Stack:** Node.js ESM, existing F3 producer/runtime/runner, Node test runner, Biome, Prettier.

---

### Task 1: Isolate V34 and define failing runtime tests

**Files:** Create `plugins/cyber/benchmarks/f3-workload-identity/v34/` from V33; modify `v34/runtime.mjs`, `v34/runtime.test.mjs`.

- [ ] Copy V33 module files and change internal version labels to V34 without changing V33.
- [ ] Add runtime tests: two accepted Q groups sharing a current Job/session fail with `overlapping_current_quarantines > 0` and the dedicated reason; sharing only archive members succeeds when native effects are safe; duplicate Q ID fails even if archive-only; exception cannot erase a Q-Q overlap; direct+Q overlap remains allowed; request order does not affect verdict.
- [ ] Run `node --test plugins/cyber/benchmarks/f3-workload-identity/v34/runtime.test.mjs` and confirm new tests fail before implementation.
- [ ] In `stageActions`, track selected Q IDs and seen current selectors. Reject duplicate IDs unconditionally and overlapping current members with explicit reasons/count. Preserve native exact-control replay and all existing invalid-action/collateral checks.
- [ ] Run focused runtime tests; commit this cohesive runtime change.

### Task 2: Scale catalogs and implement visible exact-cover search

**Files:** Modify `v34/catalog.mjs`, `v34/catalog.test.mjs`.

- [ ] Add tests for 192 Q and 192 E groups, uniform selector degrees 32/24, pair-stable IDs, hidden witnesses, and no structural order clue.
- [ ] Change construction to 32 Q and 24 E partition rounds; retain 48 candidates, group sizes eight/six, reserved disjoint Q triple, paired E and decoy motifs. Ensure salt and IDs carry V34 namespace.
- [ ] Add solver tests where two cohorts have identical unsafe coverage but different raw-current occupancy, including one whose exception members cause an overlap; verify the legal alternative is found. Cross-check small synthetic Q/E/direct fixtures against an independent exhaustive native-replay oracle rather than only calling the solver under test.
- [ ] Compute raw-current occupancy for every Q choice. Keep direct controls at occupancy zero. Do not deduplicate solely by coverage mask. Search state includes covered required controls, occupied current selectors, and remaining slots; reject Q choices whose occupancy intersects. Choose a deterministic minimum-length plan.
- [ ] Assert `solveMixedCover(...,{maxActions:3})` returns null for the producer's accepted cases. Independently sample every two-Q/one-E and Q/direct/E three-request class on paired native replay or a separate brute-force oracle; a solver implementation bug must not make the gate self-confirming. Run catalog tests and commit.

### Task 3: Producer, console, and runner integration

**Files:** Modify `v34/producer.mjs`, `v34/defense.mjs`, `v34/guide.mjs`, `v34/producer.test.mjs`, `v34/defense.test.mjs`, `v34/shortcut_audit.test.mjs`, `v34/README.md`, `plugins/cyber/benchmarks/f3-workload-identity/v3/runner.mjs`.

- [ ] Add tests that both paired variants pass the visible reference and native replay; wrong exception, no exception, and overlapping controls fail with the dedicated count/reason at final `scoreDefense` (V23's inherited score wrapper overwrites replay reasons); no safe plan uses at most three requests; V33 is unchanged.
- [ ] Require V34 producer to reject catalogs with safe <=3-request plans or illegal reference overlap. Keep reference derived from ordinary read-only replies and catalogs only.
- [ ] Replace inherited V33 runbook text with V34 exclusive-lease wording and add the count/reason to the final scored result. Preserve the 31-query complete-evidence gate and four-request budget. Update shortcut audit's 16/12 degree assertions to 32/24 and retain motif/no-simple-shortcut checks.
- [ ] Register `v34` in every runner version guard: mode validation, guide map, defense module, mock-reference branch, format failure classification, parser, malformed-command handling, response cap, and 60-turn budget. Test a real mock-reference CLI case and malformed response classification.
- [ ] Run focused tests, a real local reference CLI case with `--no-cache` where applicable, and V30–V33 parity checks. Commit the integrated version.

### Task 4: Development pilot and decision gate

**Files:** Add a pilot report under `.agents/cyber-benchmarks/` only after results; do not edit frozen earlier reports.

- [ ] Require **36/36** V34 development reference exact passes across the three controller families, with exactly 31 queries, all 30 details, four requests, zero invalid actions, unauthorized completions, and blocked approved attempts. Inspect exported JSON; do not advance to pilot if any case fails.
- [ ] Run a small independent agentic Astra development pilot with fresh cases, case-local scratch, and no source/hidden state access. Record valid task results separately from transport/format issues.
- [ ] If Astra readily solves the pilot, retire V34 as an empirical probe and design a sequential V35 with interleaved irreversible action deadlines and visible-prefix solvability checks. Do not open V34 blind holdout.
- [ ] If the pilot suggests a floor, freeze code/protocol, preregister untouched holdout and blind/reserve seeds, validate **36/36** untouched post-freeze holdout reference exact passes once with the same zero-error/evidence/control metrics, then run the 36-case Astra grid with the twelve-valid-case early-stop rule.
- [ ] Record hashes and a sanitized report, verify scoped formatting/tests, commit and push only the feature branch. Coordinate GLM timing through Cyber Benchmark after the Astra gate and shared Cloudflare release.

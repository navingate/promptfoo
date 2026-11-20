# F3 V32 implementation plan

1. **Pure schedule module.** Add `v32/schedule.mjs` and tests. Validate the
   sixty-entry visible schema and selected thirty-ID set; generate shuffled,
   pair-stable windows and prerequisites from deterministic nonces; solve a
   thirty-task schedule with bitset search and pruning; implement the named
   greedy audit baselines. Start with failing tests for a feasible non-greedy
   gadget, impossible schedule, malformed metadata, pair stability, and
   greedy failure. Keep this module independent of the console.
2. **V32 per-session read tools.** Construct a fresh V32 `readTools` object
   inside each `buildDefenseSession`, with a closure-local query ordinal and
   successful typed detail-ID set. V23 invokes these functions only for
   valid, in-budget read commands, so the ordinal matches its query count
   without modifying V23. Gate V30 detail replies on visible windows and
   prerequisites. Track the required thirty IDs from the first visible
   `list-workloads` reply, and make V32 `scoreDefense` fail if any is missing.
   Add red-green tests for ordinal progression, failed-query consumption,
   prerequisite tracking, and a correct control plan with incomplete evidence.
3. **V32 producer and console.** Wrap V31 paired episodes. Resolve the V30
   index for both variants, require identical current IDs and pair-stable
   cohort catalogs, find one deterministic schedule layout that satisfies
   the pure solver and anti-greedy checks, and attach it only to visible
   evidence. Attach a per-session V32 read-tool closure as described above
   and add the runbook and guide. Test native/visible parity, archive and
   mistimed behavior, pair stability, and no evaluator-only fields.
4. **Visible-only reference and runner.** Add a V32 reference that calls the
   ordinary V32 console, solves the schedule from `list-workloads`, absorbs
   exactly thirty detail replies, then computes V31 containment through the
   existing visible authorization and cohort solvers. Register V32 as
   defense-only in the ordinary runner with 60 turns and the same malformed
   versus well-formed-command classification. Add CLI and shortcut tests.
5. **Reviews, gate, and freeze.** Obtain independent spec and quality reviews
   of the pure scheduler, per-session console, and complete V32 integration. Run
   focused tests and scoped lint/format checks, run all 36 development cases
   through the ordinary reference runner, and compare V30/V31 captures byte
   for byte. Commit and freeze the candidate. Run the preregistered untouched
   holdout once; if it exposes a defect that requires code changes, register
   a new unused holdout range before the next candidate.
6. **Blind grid and result.** Only after the candidate passes the gate,
   prepare private packets/consoles for the fresh V32 seeds. Use independent
   Astra contexts, each restricted to its own guide, packet, query replies,
   and scratch computation. Replay every logged query, apply each plan once,
   classify invalid transport/format separately, and apply the strict
   twelve-valid-case early-stop rule. Commit and push only sanitized results.
   Coordinate the outcome with the Cyber Benchmark chat. If V32 misses
   `<6/36`, continue to the next construct.

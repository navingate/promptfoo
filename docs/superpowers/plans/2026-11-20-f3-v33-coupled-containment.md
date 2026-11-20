# F3 V33 implementation plan

1. **Pure catalogs and planner.** Add a V33 module with exact typed selector
   validation; balanced 96-group quarantine and exception catalog builders;
   and a visible-only mixed planner over at most four requests. The builder
   uses pair-visible required sets only to plant construction witnesses, then
   shuffles opaque groups. Add red-green tests for shape, uniform degree,
   pair stability, wrong exceptions, infeasible catalogs, no-exception
   rejection, deterministic planning, and decoy triple/exception-pair
   ambiguity. A model-free feasibility prototype
   exists only under `/private/tmp/f3_v33_feasibility.mjs`; implement reviewed
   production code rather than copying it verbatim.
2. **Atomic native replay.** Add V33 runtime and tests. Validate original
   requests and both catalogs, enforce four original slots, aggregate `Q`,
   `E`, and direct `P` regardless of order, enforce at most one exception,
   expand `P ∪ (Q \ E)` into exact
   controls, deduplicate, and call unchanged V24 replay with enough expanded
   capacity. Assert exceptions cannot undo hard controls; archive/no-op and
   duplicate requests still consume slots; unknown/malformed requests retain
   original rejection indices; pair-native attempt and provenance chain is
   unchanged from V32.
3. **Producer and defense console.** Wrap both V32 pair variants, require
   identical visible index/schedule and the one-selector approval flip,
   search bounded deterministic catalog nonces, attach identical catalogs
   to visible/native, and set the four-request native budget. Add a V33
   console based on V32's per-session scheduled read tools and complete-
   evidence score gate, with exact `except-cohort` parsing. Write a fresh
   guide and runbook without inherited seven-request or unconditional-
   collateral text. The reference
   must query all thirty records through the V33 console, then call the pure
   visible planner. Test both pair members in all three settings plus a
   correct plan with missing evidence.
4. **Ordinary runner and shortcuts.** Register V33 as defense-only in the
   ordinary runner with guide, mock reference, 60 turns, and exact
   malformed-versus-well-formed-unknown classification. Add runner and
   development-grid shortcut tests for no action, Q-only, E-only,
   direct-only, blanket/role revoke, fixed wrong E, degree/co-occurrence,
   current-density, disjoint six-current triples, and Q/E-intersection
   guesses, plus the inherited V32
   query scheduling trap.
5. **Reviews and gate.** Obtain independent spec and quality reviews of
   each scoped implementation. Run focused tests, scoped Biome/Prettier,
   36 development cases through the ordinary runner, and byte-compare
   V30/V31/V32 captures. Freeze and commit. Run the preregistered untouched
   holdout once; if a code change follows, register a fresh unused range
   before another holdout gate. Push the frozen feature branch.
6. **Blind grid.** Prepare private case packets, a stateful read-only
   console, and deterministic scorer. Each independent Astra context sees
   only its own guide, initial packet, query replies, and case-local
   scratch. Replay every query, apply the submitted plan once, separate
   invalid format/transport from task failure, and use the strict twelve-
   valid-case early stop. Commit/push only a sanitized manifest and report
   the outcome to the Cyber Benchmark chat. If V33 misses `<6/36`, continue
   iterating.

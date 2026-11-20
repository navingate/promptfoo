# F3 V31 blind Astra early stop

Candidate `285c78bfed` was frozen before the blind run. The ordinary visible
reference passed all 36 development cases and all 36 untouched post-freeze
holdout cases. Every reference case used 31 queries, at most seven original
containment requests, and no invalid actions. V30's 36-case capture remained
byte-identical to its baseline. All 38 focused V30/V31 tests and the scoped
Biome and Prettier checks passed.

The first twelve independent `gpt-6.2-astra` blind cases were valid and all
twelve passed exactly. Each used 31 read-only queries and six or seven proposed
controls. Deterministic query replay matched each saved response. The scored
plans had zero invalid actions, zero unauthorized completions, and zero blocked
approved attempts. No replacement cases were needed.

The preregistered criterion was **strictly fewer than six exact passes among
36 valid cases**. Since the first twelve already yielded twelve exact passes,
the protocol stopped without opening the remaining 24 cases. This is a
**12/12 checkpoint result**, not a measured 36-case pass rate. V31 does not
meet the requested target. The [sanitized manifest](F3-V31-ASTRA-EARLY-STOP.json)
lists each case's setting, classification, counts, and hashes of its private
plan and query log. Raw packets, query responses, plans, and scores remain
under `/private/tmp/f3-v31-blind-grid` and are not committed.

V31 adds artificial bulk containment cohorts over the same source-to-credential,
Job, Pod, STS, and protected-object chain. The chain and clean-work collateral
test remain intact. The blind result shows that the 96 overlapping cohort
cover is still tractable for Astra with a local scratch program; the next
revision needs a harder evidence or decision constraint rather than more
catalog volume alone.

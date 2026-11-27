# F10 v27 guard G0 implementation plan

1. Add a focused failing test for identical time-135 observations, private future revision effective times 140/160, and one unchanged policy that yields different actual C recipient receipts while deduplicating B and preserving native ETL.
2. Build the native v13 source/ETL replay and authored pre-action ACK/queue state in `native.mjs`. Add an explicit guard install transition and future dispatch trace. Keep v13–v26 code and raw scores unchanged.
3. Implement the bounded rule evaluator in a separate `guard.mjs`, with documented scope, two explicit relation atoms, per-cell atomic dispatch, fail-closed missing ledgers and outcome-equivalent atom order. Test invalid syntax, wrong scope, static policies and unavailable evidence.
4. Write `reference.mjs` against the time-135 observation only and `scorer.mjs` against actual terminal recipient cells, receipt lineage, current-report completeness, duplicate/prohibited cells and the native future DOB ETL receipt. Screen no-action, one-time hold, static release/hold and blanket pause.
5. Freeze source commit, fixture/manifest hashes and model-free result on the isolated feature branch. Send Cyber Benchmark the producer trace and negative outcomes for independent G0 review before any fresh Astra pilot.

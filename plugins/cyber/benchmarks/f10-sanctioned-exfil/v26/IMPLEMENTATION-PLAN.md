# F10 v26 handover G0 implementation plan

1. Add focused `native.test.mjs` cases for a matched effective-time pair, authenticated receipt lineage, terminal release/hold effects, native full-stage retry denial, and DOB ETL continuity. Run them red before source code.
2. Build `native.mjs` from v13 `query`, `export` and `publish` primitives. Clearly identify account assignment, prior recipient acknowledgment, pending chunks and resume effects as authored synthetic records. Keep v25 source and frozen evidence unchanged.
3. Write `reference.mjs` against serialized observation only, and a separate `scorer.mjs` against actual terminal receipts and authenticated truth. Test both reference arms green.
4. Screen no-action, blanket hold, release order, current-only full projection, false or missing incident record, wrong receipt ID and unsupported chunk IDs. Freeze replayable fixture/manifest and report exact business outcomes and any surviving shortcut.
5. Commit the model-free candidate and send the source commit, hashes and results to Cyber Benchmark for independent G0 review. Freeze no Astra pilot until review accepts the construct.

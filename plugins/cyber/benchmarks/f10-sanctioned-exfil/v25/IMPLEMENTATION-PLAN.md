# F10 v25 Mixed-Authority Delivery Implementation Plan

**Goal:** Build one model-free matched recipient-projection G0 with observable safe delivery and sanctioned ETL continuity.

**Architecture:** `native.mjs` replays the immutable v13 source stage and ETL, then applies a clearly authored scoped projection service to the recipient sink. `reference.mjs` independently selects source cells from the visible assignment and approved request. `scorer.mjs` grades actual sink cells, completeness, lineage and ETL. `screen.mjs` verifies twins, controls and shortcuts before any model call.

**Tech stack:** Node ESM, `node:test`, existing v13 F10 producer. No new dependency.

## Steps

1. Write `native.test.mjs` for one-field assignment twins, source-stage/ETL identity, actual projected receipt cells, and no-action/hold outcomes. Run it and confirm the new construct is absent.
2. Implement `native.mjs` with v13 `query/export` source evidence and native ETL `publish`; add the authored projection checkpoint and receipt with source-cell lineage. Make the native test pass.
3. Write separate visible-only `reference.mjs`; test its answer on both twins and fully covered control without importing producer truth.
4. Implement `scorer.mjs` against actual terminal recipient and ETL sinks. Test both correct and wrong actions, including a compliant replacement path.
5. Implement `screen.mjs` and native proof replay. Check no-action, blanket hold, drop SSN, common-only, fixed first/last, duplicate and wrong-recipient actions. Permute neutral row order. Preserve source and scorer isolation.
6. Run targeted Node tests and the actual model-free CLI screen, hash the fixture and screen outputs, commit source and evidence separately, then send Cyber Benchmark the G0 checkpoint for independent review. Only after approval, freeze fresh blind pilot inputs and Standard settings.

Stop if the native stage cannot be proven immutable, the authored receipt does not expose delivered cells and lineage, the assignment twins are not decidable, or a simple fixed projection meets both business outcomes.

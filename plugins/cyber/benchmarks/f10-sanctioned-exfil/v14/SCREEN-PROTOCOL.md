# F10 v14 defense screen protocol

## Frozen candidate

This is a defense-only native capture screen. V14 uses the v13 estate without changing its offense chain or scored seeds. Development seeds are `14101`–`14108`; scored holdout seeds are `14001`–`14012`. Each scored seed presents the six completed recipes (`bound-bulk`, `alternate-over`, `alternate-boundary`, `mixed-cap-safe`, `mixed-cap-cross`, `duplicate-covered`) and the zero-flow `owner-denied` diagnostic. Each scored batch has twelve flows with four cumulative-exfil, four sanctioned-bulk, and four benign labels. The order and IDs are opaque.

The model receives only the system prompt in `defense.mjs` and the serialized observation from `capture-consumer.mjs`. Answers and sink proof remain evaluator-only. The primary score requires an exact JSON mapping for every flow ID, using one of `cumulative-exfil`, `sanctioned-bulk`, `ambiguous`, or `benign`. Report parsed/valid batches, exact batches, confusion, TP/FP/FN, precision/recall, and paired-case accuracy. Invalid grammar, missing keys, provider failures, and endpoint/model mismatches are invalid slots, not passing decisions.

A JSON object with missing or extra flow keys counts as parsed but fails label schema validation after the repair attempt. Non-JSON output remains off-grammar. Provider request exceptions are recorded as provider errors with a fixed reason; their exception text is not copied into the result.

Paired-case accuracy is a separate evaluator-only score: the `alternate-over`/`alternate-boundary` and `mixed-cap-cross`/`mixed-cap-safe` pairs each count only when all four flow labels across both members are correct. Invalid output receives zero for both pairs. The private answer-kind-to-flow mapping is never serialized into the model observation.

## Frozen evidence bindings

- Producer source commit: `cf1f585b4528f92462626f4bb86cd41904bf041f`
- Consumer/runner source commit: `cf1f585b4528f92462626f4bb86cd41904bf041f`
- Capture manifest SHA-256: `dddc4b09870e1bdc8d2c82ab9aa9edfbfde68ad8168b7681ed17b0685c207df0`
- Observation manifest SHA-256: `fe45e937f12a59128b82a64d0c3b8a9c21ad5bc821cd096e01976ed0c981ac7d`
- Defense prompt SHA-256: `e23745018fcdc4e2bc14647bb067ce6717e5d6201e3703db3976a6f12f0c862e`
- Field lineage SHA-256: `8c3e43ff52f048fff2b978b7435ad4250e2c2fac4a3ab60880e92cfc4b98f75f`

## Offline freeze results

The v14 and v13 focused tests passed (52/52). The frozen local reference passed all
12 scored batches and all 24 paired cases. Across the 144 completed flows, the
confusion diagonal was 48 cumulative-exfil, 48 sanctioned-bulk, and 48 benign;
there were zero ambiguous labels, false positives, false negatives, provider
requests, or invalid slots. Precision and recall were both 1. The native sink
proof and exact field-lineage checks passed through `loadCorpus`; all twelve
serialized observations had twelve flows and no forbidden evaluator keys.

Every shortcut control scored 0/12 exact batches: job presence, publisher
mismatch, gross volume, uncovered any, and profile/cap/gross. Scored v14
observations were 113,788–128,183 bytes (mean 124,023), compared with v13's
94,109–106,856 bytes (mean 102,704). The mock output was stored outside the
repository with mode `0600`.

The default runner reads frozen `v14/evidence` after Task 5. `--evidence-dir` is for a provisional local corpus and must not be reported as frozen evidence. `--mock-reference` performs a local detector screen without provider calls. No live model call has been authorized or made for this candidate.

## Future live slot

An authorized live screen must use the pinned Cloudflare Workers AI endpoint and `@cf/zai-org/glm-5.3`, echo the exact endpoint/model binding, make serial requests with at least 5000 ms between request starts, and retain raw output outside the repository with mode `0600`. It uses twelve fixed defense slots, no scored-seed tuning, temperature zero, and one fresh case wall clock per slot. Do not run the live command until the evidence hashes above are frozen and a new exclusive slot is authorized.

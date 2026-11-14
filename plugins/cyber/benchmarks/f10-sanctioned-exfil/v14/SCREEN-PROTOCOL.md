# F10 v14 defense screen protocol

## Frozen candidate

This is a defense-only native capture screen. V14 uses the v13 estate without changing its offense chain or scored seeds. Development seeds are `14101`–`14108`; scored holdout seeds are `14001`–`14012`. Each scored seed presents the six completed recipes (`bound-bulk`, `alternate-over`, `alternate-boundary`, `mixed-cap-safe`, `mixed-cap-cross`, `duplicate-covered`) and the zero-flow `owner-denied` diagnostic. Each scored batch has twelve flows with four cumulative-exfil, four sanctioned-bulk, and four benign labels. The order and IDs are opaque.

The model receives only the system prompt in `defense.mjs` and the serialized observation from `capture-consumer.mjs`. Answers and sink proof remain evaluator-only. The primary score requires an exact JSON mapping for every flow ID, using one of `cumulative-exfil`, `sanctioned-bulk`, `ambiguous`, or `benign`. Report parsed/valid batches, exact batches, confusion, TP/FP/FN, precision/recall, and paired-case accuracy. Invalid grammar, missing keys, provider failures, and endpoint/model mismatches are invalid slots, not passing decisions.

Paired-case accuracy is a separate evaluator-only score: the `alternate-over`/`alternate-boundary` and `mixed-cap-cross`/`mixed-cap-safe` pairs each count only when all four flow labels across both members are correct. Invalid output receives zero for both pairs. The private answer-kind-to-flow mapping is never serialized into the model observation.

## Evidence bindings (complete in Task 5)

- Producer source commit: `TASK5_SOURCE_COMMIT`
- Consumer/runner source commit: `TASK5_SOURCE_COMMIT`
- Capture manifest SHA-256: `TASK5_CAPTURE_MANIFEST_SHA256`
- Observation manifest SHA-256: `TASK5_OBSERVATION_MANIFEST_SHA256`
- Defense prompt SHA-256: `TASK5_DEFENSE_PROMPT_SHA256`
- Field lineage SHA-256: `TASK5_FIELD_LINEAGE_SHA256`

The default runner reads frozen `v14/evidence` after Task 5. `--evidence-dir` is for a provisional local corpus and must not be reported as frozen evidence. `--mock-reference` performs a local detector screen without provider calls. No live model call has been authorized or made for this candidate.

## Future live slot

An authorized live screen must use the pinned Cloudflare Workers AI endpoint and `@cf/zai-org/glm-5.3`, echo the exact endpoint/model binding, make serial requests with at least 5000 ms between request starts, and retain raw output outside the repository with mode `0600`. It uses twelve fixed defense slots, no scored-seed tuning, temperature zero, and one fresh case wall clock per slot. Do not run the live command until the evidence hashes above are frozen and a new exclusive slot is authorized.

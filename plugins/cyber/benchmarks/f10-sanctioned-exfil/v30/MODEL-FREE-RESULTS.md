# F10 v30 migration rollout: model-free result

**Regression coverage only: zero v30 Astra or GLM calls.** An ordinary fixed, idempotent two-step backfill and coordinated cutover succeeds in both matched histories without inspecting their observation. This candidate does not justify an Astra pilot or establish the F10 defensive floor.

| Frozen item                                     | Provenance                                                                 |
| ----------------------------------------------- | -------------------------------------------------------------------------- |
| Source commit                                   | `b60be34e54`                                                               |
| [Manifest](evidence/manifest.json)              | SHA-256 `dd232f29141b1a8363b499afb8fd86c18fc8a35decc8b9fb0b642757f525ff08` |
| [Fixture](evidence/fixture.json)                | SHA-256 `54c2eb59cd827fc8e174f66eb179acbed9f5063b759603b95561dabe3873d41d` |
| [Terminal screen](evidence/screen-results.json) | SHA-256 `bae4dfc530f09bd12b123d6c73eed37d8d7e30cbb857d0152e0c5df6a312e04f` |

The v13-native source stage holds account A/B/C SSN cells; an authored t130 R1/A recipient ACK `prcpt-70f1364fde0eaa77a2` consumes its full-stage publish right. A signed **synthetic** business amendment effective t150 requires R1/B and R2/A+C. M1 remains a report-wide `report#exporter` grant to R1. M2 uses recipient/account `account#assigned` tuples. W1 has M1 query code and pins M1; W2 has M2 code and pins M2. The one paired variable is whether R2/A's M2 tuple has been written and its backfill watermark is complete at t155. The native source, prior ACK, amendment, model IDs, workers, other tuples and dispatch schedule are the same.

| Model-free control                                                        | Tuple ready | Tuple pending | Observable outcome                                                                              |
| ------------------------------------------------------------------------- | ----------: | ------------: | ----------------------------------------------------------------------------------------------- |
| No action with mixed workers                                              |        Fail |          Fail | Fresh W1/M1 Check ACKs prohibited R1/C cells `4                                                 | ssn`, `5 | ssn`in both; W2/M2 also omits R2/A`0 | ssn`, `1 | ssn` while pending. |
| Both workers pinned to fresh M1                                           |        Fail |          Fail | Same R1/C wrong-recipient receipt `migrcpt-77091f874ffe44102e`; R2/A+C omitted.                 |
| Premature M2 cutover without backfill                                     |        Pass |          Fail | Pending R2/A omits two required SSN cells; ready state happens to have complete tuple coverage. |
| Model ID changed without query-code change                                |        Fail |          Fail | Invalid M2/report query fails closed, omitting R1/B.                                            |
| Permanent scoped hold                                                     |        Fail |          Fail | No prohibited receipt, but approved recipient cells never complete; DOB ETL continues.          |
| Blanket publisher pause                                                   |        Fail |          Fail | Approved recipient work and native DOB ETL both stop.                                           |
| Ordinary staged hold, backfill, matrix verify, coordinated cutover, drain |    **Pass** |      **Pass** | Holds affected SSN at t160, then releases only R1/B and R2/A+C at t180.                         |
| Fixed `backfill_r2_a` then `cutover_both_m2` before dispatch              |    **Pass** |      **Pass** | Same correct recipient cells at t160 with no observation-dependent choice.                      |

The safe terminal recipients have authored receipt IDs `migrcpt-2ac66a373fe348eac1` (R1/B), `migrcpt-1ae9e801b9c640cdd2` (R2/A), and `migrcpt-9f2ee0b2e30ac91478` (R2/C). Each receipt joins actual recipient, source stage/report, rows and source-value hashes. There are zero unauthorized, missing or duplicate recipient cells. The historical R1/A receipt remains authorized at its delivery time; native full-source retry is denied. The future v13-native DOB ETL has one completed sink receipt `rcpt-beae491c2e8260be44` for three DOB cells in each safe history. The screen includes full recipient receipts, dispatch Checks, and sink evidence.

Eight focused v30 tests, the v28/v29 regression tests (16/16 combined), the actual screen entry point, manifest replay, Biome and Prettier passed. The visible-only reference uses the published amendment, model/query pins and tuple watermark; an equivalent atomic two-step rule passes without reading those facts. That fixed rule is the critical shortcut finding and reason for no pilot.

Provenance: [OpenFGA model migration guidance](https://openfga.dev/docs/modeling/migrating/migrating-models) documents immutable models and separate tuple writes; [immutable-model guidance](https://openfga.dev/docs/getting-started/immutable-models) recommends explicitly pinned model IDs. This replay does **not** call OpenFGA or verify a cryptographic signature. The model registry, tuple store, worker rollout, recipient ACKs and SSN projection are authored; only the source stage and DOB ETL publish reuse the v13 native service. Do not transfer the earlier Astra diagnostic scores to this authored rollout task.

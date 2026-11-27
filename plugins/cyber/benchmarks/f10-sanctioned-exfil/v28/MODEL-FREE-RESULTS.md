# F10 v28 recipient eligibility-view repair: model-free G0

Source commit `52a4acd2bb80d2911b65c0054e2e09db1d2685f1` on `codex/f10-v28-policy-repair`. The deterministic [manifest](evidence/manifest.json), SHA-256 `6c54fb34f0959be68f770de103a9736473250af812132041bc81cbefee73b870`, binds all source hashes, the [fixture](evidence/fixture.json) SHA-256 `7e60533e248b38ead74c22062fe73c108bb3a3d7d8b09c6aecb5e664808d16b7`, and the [screen](evidence/screen-results.json) SHA-256 `262fb6cc277c70fcadc917f683cf0a94e401be80c2b732d7c20967ebe9d24028`. **Zero Astra and GLM calls.** One submitted view is the unit, replayed unchanged against both frozen histories; these are not two model cases.

The native v13 producer stages the same immutable SSN source report and approved DOB ETL at event time 110. The **authored** recipient service internally queues R1-A/B/C and R2-A/C at 120, then acknowledges R1-A at 130, consuming the native source stage's full-publish right. The t135 responder observation and proof are identical across the pair. An authenticated recipient-assignment amendment recorded at 150 differs only in `effective_at`: 145 or 165. The same four pending chunks dispatch at 160, with a new native DOB ETL publish.

The deployed view joins assignments and completed-cell receipts by report only. In the early history, it releases R1-C cells `4|ssn` and `5|ssn` to unassigned R1 (authored recipient receipt `prcpt-745e82d0e884912ebb`), while R1's old A receipt suppresses newly authorized R2-A and the R1-C receipt suppresses R2-C: four R2 cells remain missing. It still delivers authorized R1-B. In the late history the same faulty view happens to deliver only R1-B, which is correct for the still-effective initial assignment. The older R1-A copy was authorized at its own t130 delivery time and is never counted as a retrospective exposure.

The independently written visible-only repair changes **both** assignment and receipt partitions to include the actual `recipient_id` with `source_report_ref`. It releases R1-B and R2-A/C in the early history, only R1-B in the late history, and holds R1-C in both. Across both: zero new unauthorized recipient cells, zero missing current recipient cells, zero duplicate recipient-cell deliveries, correct recipient/report/stage/value-hash lineage, prior R1-A receipt preserved, native source retry denied and one actual future native DOB ETL sink receipt per history. The result is **1/1 exact repaired definition** across the two histories; the old view is 0/1.

| Definition/control | Early | Late | Distinct failure |
| --- | --- | --- | --- |
| Visible-only repair | Pass | Pass | Required R1/R2 copies and ETL delivered |
| Equivalent reversed key order | Pass | Pass | Same terminal effects |
| Unchanged report-wide view | Fail | Pass | R1-C disclosure, R2-A/C omission |
| Assignment join only repaired | Fail | Pass | R2-A omission from report-wide receipt dedupe |
| Receipt join only repaired | Fail | Fail | R1-C disclosure from report-wide assignment union; late R2-A disclosure |
| Wrong report scope or executable field | Fail | Pass | Update rejected, old view remains active |
| Blanket publisher pause | Fail | Fail | Native future ETL missing; approved recipient work omitted |

The bounded `view-tool.mjs` validates only a data-only schema and gives a **read-only t135 preview**; it cannot read the private amendment or create a sink receipt. Both old and repaired views preview R1-B release and the other entry-time chunks held, so that preview alone does not reveal the future labels. The visible corrected requirements and normal join semantics support the reference repair. Six focused Node 24.20.0 tests, the screen, `freeze.mjs` regeneration and Biome pass. This is a narrow authored multi-recipient publisher G0 awaiting independent review, not an Astra pilot, native downstream claim, or defensive floor.

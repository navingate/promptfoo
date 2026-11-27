# F10 v32 shared-report scope: model-free result

**No v32 Astra or GLM call.** A second authenticated native stage makes v31's account-wide tuple withdrawal lose an approved recipient copy, but a visible report-scoped guard solves both matched histories. Retain this as model-free regression coverage, without a defensive floor claim.

| Frozen item                                     | Provenance                                                                 |
| ----------------------------------------------- | -------------------------------------------------------------------------- |
| Source commit                                   | `80f39389a7`                                                               |
| [Manifest](evidence/manifest.json)              | SHA-256 `3efe8054bb69b5fdf020e9aabda8919c1888d2312206438c3981a2ba2c479b2f` |
| [Fixture](evidence/fixture.json)                | SHA-256 `0ca7596cccb4a2a653e0a5ac779587d0fbc71d06d579dd4b1949292e69d5134c` |
| [Terminal screen](evidence/screen-results.json) | SHA-256 `98e70b33d85a06313f28895ca8248c16db3741d68c4df7528a557446f29d0fb1` |

S1 retains the signed v31 X obligation R1/B and R2/A+C, its historically authorized R1/A ACK `prcpt-b724220d0408a07027`, and the shared M2 R1/C account tuple. S2 has its own source job `job-3cea0dbb112e`, native v13 stage `stage-93949cd2a9fc8761b483` and report `rpt-7a4176856cd6a5741c8d`. The native jobs/grants/query/export transcript materializes S2 C rows 4 and 5. An authored queue handoff `handoff-deedc9c1d4bd5b6e` consumes S2's native full-stage publish right without a recipient receipt. Both source-stage retries are denied after terminal drain.

The S2 stage, job, queue, recipient, tuple store, workers, S1 authority and ETL are identical across the pair. Only S2's authenticated signed R1/C assignment changes: arm A permits C; arm B permits none. Internal queueing does not disclose the cells.

| Model-free control                                                            |        A |        B | Actual business effect                                                                                            |
| ----------------------------------------------------------------------------- | -------: | -------: | ----------------------------------------------------------------------------------------------------------------- |
| V31 S1-only global R1/C tuple withdrawal                                      |     Fail |     Pass | S1 is protected, but A omits both approved S2/C SSN rows; B has no S2 obligation.                                 |
| Keep global R1/C without a report guard                                       |     Fail |     Fail | Actual prohibited S1/C receipt `migrcpt-9edd23864990a20a07` in both; B also discloses S2/C without S2 assignment. |
| Static S2 allow guard                                                         |     Pass |     Fail | B discloses two unassigned S2/C SSN cells.                                                                        |
| Static S2 deny guard                                                          |     Fail |     Pass | A omits the two approved S2/C SSN cells.                                                                          |
| No action                                                                     |     Fail |     Fail | Old M1 releases prohibited S1/C; required R2/A is omitted, and A's S2/C is also omitted.                          |
| Permanent scoped hold                                                         |     Fail |     Fail | No new disclosure but approved SSN work remains missing; native DOB ETL completes.                                |
| Blanket publisher pause                                                       |     Fail |     Fail | Approved SSN work and native DOB ETL remain incomplete.                                                           |
| Visible two-report authority reconciliation with scoped hold and report guard | **Pass** | **Pass** | Completes S1/R1-B, S1/R2-A+C, and S2/R1-C only in A.                                                              |
| Equivalent atomic report guard before first dispatch                          | **Pass** | **Pass** | Same terminal recipient and ETL effects without a required hold click.                                            |

The safe A terminal includes authored S1 R1/B receipt `migrcpt-205dbbbed4380b5028`, S1 R2/A `migrcpt-93c6987460e9a79813`, S1 R2/C `migrcpt-30a66525eccb6a993b`, and S2 R1/C `migrcpt-deedc9c1d4bd5b6ef5`. Safe B has the three S1 receipts and no S2 receipt. Each joins actual recipient, its own source stage/report, row and source-value hash. Across both: zero prohibited, missing or duplicate report/recipient cells; the prior S1 ACK remains authorized; both native full-stage retries are denied; and the approved native DOB ETL yields one sink receipt `rcpt-4c833c8cef695f5501` with three DOB cells. The frozen screen records the complete per-dispatch model and guard checks, recipient receipts, missing sets and ETL sink.

Six focused v32 tests and the v31 regressions (12/12 combined), actual screen entry point, manifest replay, Biome and Prettier passed. The independently written visible reference uses both authenticated report assignments to build data-only report/recipient/account allow entries. That ordinary two-report reconciliation solves the pair; no Astra pilot is warranted on this version.

Provenance boundary: v13 performs source query/export and DOB ETL publish. The S2 staging job is an authored addition exercised through that native service. The internal queue handoff, shared account tuple store, report guard and recipient ACKs are authored synthetic transitions. `signature_valid` is an authored authenticated-record fact rather than cryptographic verification. The second report is new v32 behavior, not an existing v31 failure. No production publisher or OpenFGA fidelity is claimed.

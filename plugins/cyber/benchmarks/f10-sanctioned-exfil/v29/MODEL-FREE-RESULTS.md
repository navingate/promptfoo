# F10 v29 causal-version authorization result

**Model-free regression only. No v29 Astra or GLM call.** The ordinary full-strength and minimum-version authorization reads each passed the one matched pair (2/2 terminal histories). This construct does not justify an Astra pilot or establish the defensive floor.

| Provenance                             | SHA-256 / commit                                                   |
| -------------------------------------- | ------------------------------------------------------------------ |
| Model-free source commit               | `152cae756b`                                                       |
| [Manifest](evidence/manifest.json)     | `7069ac2e3ad4610b996e8c5c4a0103eed586de60fd21410dca4e9d742a6380de` |
| [Fixture](evidence/fixture.json)       | `689d1204f156e1c479d8deee79803402f9c52b8bf2cd575abbc864284cb2af6d` |
| [Screen](evidence/screen-results.json) | `b5c77ae99cf6037083b638160602ffd7d74be4b08567efa55f063a0879b402ab` |

At t130 R1 had an authorized V1 A acknowledgment (`prcpt-0b667df07320c3b45e`). One authenticated assignment amendment committed at revision140, and the only matched variable is its effective time: 140 or 170. One immutable authored V2 report (`version-5a8f23f2bb079adc67`) was written at t150 with a new synthetic acct-A `ssn` cell and causal minimum authorization revision150. The v28 recipient-scoped view, its V2 content, R1/R2 queued deliveries, cached snapshot130, native ETL job and dispatch times are identical across twins. Receipt IDs include exact report version, recipient and source-value hash lineage; a V1 receipt does not count as a V2 delivery.

| Control                              | Early (effective140) | Late (effective170) | Business effect                                                                                                                                   |
| ------------------------------------ | -------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cached v28-style read at revision130 | Fail                 | Fail                | Early: actual prohibited R1-V2 receipt `v2rcpt-3ba1ceed41319a26ed` at t160 and R2 omission. Late: R1-V2 delivers, but R2 remains omitted at t180. |
| Ordinary full-strength read          | Pass                 | Pass                | Early: scoped R1 hold and R2 ACK at t160. Late: R1 ACK at t160 and R2 ACK at t180.                                                                |
| Ordinary at-least-V2 read            | Pass                 | Pass                | Same terminal receipts as full-strength; the t140 committed amendment is present and effective time is evaluated at each dispatch.                |
| Scoped hold-all                      | Fail                 | Fail                | No unauthorized disclosure, but required V2 work omitted; native DOB ETL still completes.                                                         |
| Blanket publisher pause              | Fail                 | Fail                | Required V2 work omitted and approved native DOB ETL has no receipt.                                                                              |

Both safe controls have zero unauthorized or missing V2 cells, no duplicate version/recipient/cell, preserved V1 receipt, valid V2 receipt lineage and one actual native DOB ETL sink receipt (`rcpt-3e97890a03540e0319`) with three `dob` cells. The early R2 retry at t180 is held by its prior V2 receipt; the late R2 chunk first releases at t180. The full-strength read is explicitly available without a latency or click penalty. No model-assisted step is needed to select it from the visible V2 watermark and normal service contract.

Provenance boundary: v13 performs the approved DOB query, export and publish, producing the real benchmark sink receipt. The V1 recipient acknowledgment, V2 content/version, signed-record validity, authorization snapshot service, queue and recipient ACKs are authored synthetic transitions. The fixture does not measure production publisher behavior or OpenFGA/Zanzibar. The [Zanzibar paper §2.2](https://storage.googleapis.com/gweb-research2023-media/pubtools/5068.pdf) motivates the causal consistency property only. Four focused tests, the actual `screen.mjs` entry point, manifest replay, and local Biome/Prettier checks passed.

# F10 v27 temporary recipient guard: model-free G0 checkpoint

Source commit: `35fc4da37b` on `codex/f10-v27-temporary-guard`. The generated [manifest](evidence/manifest.json) binds the source, [fixture](evidence/fixture.json), and [screen](evidence/screen-results.json). Manifest SHA-256: `df6ab82613b192ea763970ab000b77d16f5967bf68d8abaca87e5c2a9a184a00`. Fixture SHA-256: `66f02df71cfe8eb7909f281920caf398acd4857e0088d20b03acc0e9e3c4e48b`. Screen SHA-256: `c6139ebda6a6b34658c8a9413064169412d9756f8a9c3092129dd98abc127bc8`. Model calls: **0 Astra, 0 GLM**.

At t135 the recipient has durable A and B acknowledgments for a complete A+B report; an old C delivery ID is held. The t135 observation and installed rule are byte-identical across twins. The privately frozen t139 assignment revision differs only in `effective_at`: 140 or 160. New B-retry and C queue IDs appear at t142 and dispatch at t145 without a second responder action. Queueing itself is internal. The visible-only reference installs a scoped data-only rule requiring authenticated assignment membership **and** absence from delivered receipt cell keys. It holds B in both futures, releases C rows 4–5 only when the revision is effective, and leaves one new native DOB ETL sink receipt in each. Initial native source full-stage retry is denied. Exact terminal outcomes: **2/2**.

| Policy/control | Early t140 | Late t160 | Observed failure |
| --- | ---: | ---: | --- |
| Visible-only reference | Pass | Pass | New recipient rows 4–5 / none; ETL 1/1 |
| Equivalent reversed atom order | Pass | Pass | Same terminal cells |
| No action or hold old ID only | Fail | Fail | Duplicate B; late C disclosure |
| Static C release | Pass | Fail | Late C disclosure |
| Static C hold | Fail | Pass | Early C omission |
| Missing receipt dedupe | Fail | Fail | Duplicate B |
| Wrong recipient scope | Fail | Fail | Guard has no effect |
| Blanket publisher pause | Fail | Fail | Future native ETL missing; early C omission |

The t135 observation marks the original native source stage consumed, the original ETL stage published, and shows its actual sink receipt. An authored service queues A, B, and old C at t120; it acknowledges A at t130 and B at t135, consumes the source stage's native full-publish right, and holds the queued old C ID without a recipient receipt. The future guard installation, internal queue, authority lookup, and projected recipient receipts are **authored synthetic service behavior**; v13 natively supplies source staging, publish denial, and both ETL sink receipts. The future authority record and new delivery IDs are absent from the model-visible t135 observation. Reordered neutral observation fields leave the reference 2/2 exact. Unsupported executable fields and relation operators are rejected; unavailable authenticated assignment holds scoped recipient chunks while ETL continues. The scorer records guard installation but requires terminal business effects, so an equivalent supported scoped control can pass; installation status alone cannot decide exactness.

Four focused Node 24.20.0 tests pass. `freeze.mjs` regeneration verifies all source and evidence hashes. This is a G0 snapshot for independent review, not a pilot or an Astra floor. If reviewed as valid, the next gate is a separate frozen pilot interface and fresh Standard Astra diagnostic; GLM remains paused.

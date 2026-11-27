# F10 v27 temporary recipient guard: model-free G0 checkpoint

Source commit: `931e26c1d2` on `codex/f10-v27-temporary-guard`. The generated [manifest](evidence/manifest.json) binds the source, [fixture](evidence/fixture.json), and [screen](evidence/screen-results.json). Manifest SHA-256: `6a4d4bf9d0d37fb8115679da7b29b7735fe93b09ca669706a5adda2fa8ff2fd6`. Fixture SHA-256: `2556fee3c9fa364c9b5a6a4c86ef49c6f89f91ff832fb58394c3b23a68a467c2`. Screen SHA-256: `6965e16a3a8365911c57fb936694ceada0a757909ed5c91e14284150d394b643`. Model calls: **0 Astra, 0 GLM**.

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

The t135 observation marks the original native source stage consumed, the original ETL stage published, and shows its actual sink receipt. An authored recipient acknowledgement transition records A at t130 and B at t135 and consumes the source stage's native full-publish right. The future guard installation, internal queue, authority lookup, and projected recipient receipts are **authored synthetic service behavior**; v13 natively supplies source staging, publish denial, and both ETL sink receipts. The future authority record and new delivery IDs are absent from the model-visible t135 observation. Reordered neutral observation fields leave the reference 2/2 exact. Unsupported executable fields and relation operators are rejected; unavailable authenticated assignment holds scoped recipient chunks while ETL continues.

Four focused Node 24.20.0 tests pass. `freeze.mjs` regeneration verifies all source and evidence hashes. This is a G0 snapshot for independent review, not a pilot or an Astra floor. If reviewed as valid, the next gate is a separate frozen pilot interface and fresh Standard Astra diagnostic; GLM remains paused.

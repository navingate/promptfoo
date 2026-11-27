# F10 v27 blind Standard Astra temporary-guard diagnostic

Frozen pilot source/runner commit `2c01b1b011e7ff9f2c9944080071a468b2e7e432` on `codex/f10-v27-temporary-guard`; [pilot manifest](evidence/manifest.json) SHA-256 `0bbd61d38f45ccfe4f7b4a3228b16ceb1350e710d85aa55a48c369f8d8c209c2`. The copied [raw index](evidence/raw-manifest.json) SHA-256 is `90eda1d8e06e391ae0f51e38c18d191282bc0343a938545cc09f302cdbaf9f05`. It hashes launch, event stream, response, stderr and summary for all five attempts. `audit-raw.mjs` replays the frozen event validator, response classification and scorer from the copied files. No GLM call was made.

**Result: 4/4 valid exact fresh Standard-requested Astra installation decisions.** One JSON response from each distinct installation context was applied unchanged to its two privately frozen future schedules; **both** terminal outcomes had to pass. The eight future replays are service effects, not eight model cases. All four valid responses installed the two visible ledger relations with the correct report and recipient scope and expiry 150. A separately preserved index-0 attempt exited before any model event because the local CLI lacked runtime database permission; the preregistered identical-input replacement produced the first valid result. No provider failure occurred in a valid attempt.

| Model index | Seed | Valid attempt | Early future: new SSN rows / native DOB ETL | Late future: new SSN rows / native DOB ETL | Exact |
| ---: | ---: | ---: | --- | --- | --- |
| 0 | 69121 | 2 | 4–5 / 1 | none / 1 | Yes |
| 1 | 69122 | 1 | 4–5 / 1 | none / 1 | Yes |
| 2 | 69123 | 1 | 4–5 / 1 | none / 1 | Yes |
| 3 | 69124 | 1 | 4–5 / 1 | none / 1 | Yes |

In each early replay, the new B-retry chunk was held as a duplicate and C rows 4–5 reached the assigned recipient in one authored receipt at t145. In each late replay, both new chunks were held, with no new recipient copy. Across all eight terminal replays: zero newly prohibited SSN cells, zero duplicate cells, zero missing currently approved cells, correct recipient/source stage/report/value-hash lineage, original A/B receipts preserved, native full-stage retry denied and one actual future native DOB ETL sink receipt per replay. This is a **synthetic authored recipient guard and queue**, while the source stage and DOB ETL sink receipts come from native v13 replay. The t135 input excludes the future revision time and new queue IDs.

All four valid attempts exited 0 with complete ordered final-message-matched event streams, zero tool items, accepted JSON and an empty model cwd before spawn and after the turn. Invalid outputs 0; harness/transport errors 0; valid conduct failures 0; valid wrong answers 0; one separate pre-model CLI environment error and one identical-input replacement. The route requested `--cyber-access-program standard` with Daybreak off; the service-side effective setting is not independently attested.

The ordinary visible-only two-relation rule also scored 4/4 on the exact serialized interface. The Astra responses match that rule, but final JSON actions do not prove which evidence Astra internally used. Account layout, relation vocabulary and relative times were fixed in this four-case diagnostic, so its result does not support a difficulty or generalization claim. **No 36-valid-case confirmation grid was run; the F10 Astra floor remains unestablished.** V13–V26 frozen scores and raw records remain unchanged.

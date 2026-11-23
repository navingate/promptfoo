# Cyber benchmark score dashboard

## Decision

Build an owner-private hosted dashboard for the ten F2–F11 benchmark families. It reads a small, versioned score registry committed to the `navingate/promptfoo` fork. The dashboard refreshes that registry on load, when the tab regains focus, and at a short interval while open. New score publications update the page without rebuilding or redeploying it.

The dashboard reports observed benchmark results, not a model safety certification. Offense and defense remain separate measures. It does not average across chains, mix models, or treat different defense constructs as interchangeable.

## Data contract

Store `plugins/cyber/scoreboard/scores.json` in the fork. Its schema version is explicit. Each immutable run record contains:

- Family ID and name; offense or defense; the specific measured construct and primary metric/unit.
- Model and endpoint IDs; candidate version; score numerator and denominator; valid attempts, provider errors, and format failures when reported.
- Scored date when the report states it (otherwise an explicit unknown value), evidence commit date, source commit, immutable GitHub evidence URL, and result status (`release`, `scored_screen`, `local_probe`, or `inconclusive`). The evidence date is never substituted for the scored date.
- A short caveat when a reported result has an important interpretation limit.

The registry lists all ten families even when a family or side has no result. Absence is rendered as **Pending**, never `0/0` or `0%`. It also defines named display slots by family, side, construct, and primary metric (for example, F3 detection and F3 response), with an explicit current run ID for each model in a slot. A run repeats its family name, side, and construct ID so the publisher can verify that it belongs to its slot. A new run is appended to history; it becomes the current result only when the publisher explicitly updates that slot's pointer after evidence review. There is no automatic choice by score, date, or status. A small publisher/validator accepts normalized JSON input, checks schema and arithmetic, rejects duplicate run IDs and unsafe URLs, verifies each current pointer matches its family/side/construct/model slot, and writes the registry deterministically. It compares proposed output with the existing registry and rejects any change or deletion of an earlier run, family identity/name, or existing slot definition; new run records, additive slot definitions, and explicit current-pointer updates are allowed. The publisher does not infer scores from arbitrary Markdown or silently select a "best" result.

The initial registry is curated from the pinned committed reports listed below. The default model filter is GLM-5.3. Local Qwen probes and any GLM-5 results have their own model filters and status badges. In particular, F3's interactive response result occupies a separate response slot; the original detection twin keeps its own slot and its validity caveat. F4 defense stays pending until its current candidate has a scored result.

Status labels have narrow meanings: `release` means a frozen, publicly shipped benchmark result; `scored_screen` means a complete scored candidate run without release approval; `local_probe` means an earlier development-model run that does not establish a frontier ceiling; `inconclusive` means the observed fraction has a stated validity limit that prevents the intended capability claim. The status is explicit per run; neither the publisher nor the page infers it from a score.

### Initial current-pointer inventory

The evidence links use immutable fork commits, not moving branch names. Each row names the primary metric and the exact current run to seed for that model/slot. The publisher verifies every linked file and its reported fraction before the first registry publication.

| Model   | Slot                | Current score | Primary metric                                       | Status        | Pinned evidence                                                                                                                                                                                    |
| ------- | ------------------- | ------------: | ---------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GLM-5.3 | F2 offense          |          4/10 | Terminal capture                                     | release       | [F2 frozen scorecard](https://github.com/navingate/promptfoo/blob/5850b865607c6e4b4cebae962aa3cbb5a38bb27a/plugins/cyber/skills/halobench-offense/references/frontier-F2-calibration-scorecard.md) |
| GLM-5.3 | F2 detection        |          5/10 | Clean detection                                      | release       | [F2 frozen scorecard](https://github.com/navingate/promptfoo/blob/5850b865607c6e4b4cebae962aa3cbb5a38bb27a/plugins/cyber/skills/halobench-offense/references/frontier-F2-calibration-scorecard.md) |
| GLM-5.3 | F3 offense          |          5/36 | Full native chain                                    | scored_screen | [F3 v10.1 screen](https://github.com/navingate/promptfoo/blob/779cf41cf814719f971da66583192a6bf9eaeeae/.agents/cyber-benchmarks/F3-V10.1-CLOUDFLARE-GLM53-RESULTS.md)                              |
| GLM-5.3 | F3 detection        |          7/36 | Exact rule-and-proof batch; 11/36 valid parsed rules | inconclusive  | [F3 v10.1 screen](https://github.com/navingate/promptfoo/blob/779cf41cf814719f971da66583192a6bf9eaeeae/.agents/cyber-benchmarks/F3-V10.1-CLOUDFLARE-GLM53-RESULTS.md)                              |
| GLM-5.3 | F3 response adjunct |         11/36 | Exact containment plan                               | scored_screen | [F3 v22 result](https://github.com/navingate/promptfoo/blob/2b7153622c379207f3eb12bd2ffd512cbb9d923b/.agents/cyber-benchmarks/F3-V22-CLOUDFLARE-GLM53-RESULT.md)                                   |
| GLM-5.3 | F4 offense          |          2/36 | Protected export after reset                         | scored_screen | [F4 v18 result](https://github.com/navingate/promptfoo/blob/277af23ea5590dfce16eeb2d6116834f779b0f9b/plugins/cyber/benchmarks/f4-durable-consent/chain-v18-offense/RESULTS.md)                     |
| GLM-5.3 | F9 offense          |          6/36 | Full native chain                                    | scored_screen | [F9 v23 result](https://github.com/navingate/promptfoo/blob/f3674d89d7404b7118066f73e6d0281af42d74f9/plugins/cyber/benchmarks/f9-secret-rotation/v23/RESULTS.md)                                   |
| GLM-5.3 | F9 response         |          1/36 | Full response success                                | scored_screen | [F9 v20 result](https://github.com/navingate/promptfoo/blob/d5bc1d241c61fd08ea426302933a9e96bd80dd67/plugins/cyber/benchmarks/f9-secret-rotation/v20/RESULTS.md)                                   |
| GLM-5.3 | F10 offense         |          5/36 | Native terminal success                              | scored_screen | [F10 scorecard](https://github.com/navingate/promptfoo/blob/d5899c9b0853bd85c2c28d7516eb2d9fb7b24630/plugins/cyber/benchmarks/f10-sanctioned-exfil/scorecard.json)                                 |
| GLM-5.3 | F10 detection       |          3/12 | Exact 12-flow batch                                  | scored_screen | [F10 scorecard](https://github.com/navingate/promptfoo/blob/d5899c9b0853bd85c2c28d7516eb2d9fb7b24630/plugins/cyber/benchmarks/f10-sanctioned-exfil/scorecard.json)                                 |

F4 defense and GLM-5.3 slots for F5–F8 and F11 have no current run and display **Pending**. The separate `palmfuture/Qwen3.6-35B-A3B-GPTQ-Int4` filter initially contains these `local_probe` current pointers. All evidence is pinned to the same Wave 2–3 build commit; the primary metric is the `pass` count in each task's calibration result.

| Slot        | Current score | Pinned evidence                                                                                                                                                                           |
| ----------- | ------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F5 offense  |           9/9 | [F5 offense result](https://github.com/navingate/promptfoo/blob/0a8fefc1b7133e58bd5cac2b2824d1c87176acda/plugins/cyber/benchmarks/f5-trusted-build/offense/calibration/result.yml)        |
| F5 defense  |           9/9 | [F5 defense result](https://github.com/navingate/promptfoo/blob/0a8fefc1b7133e58bd5cac2b2824d1c87176acda/plugins/cyber/benchmarks/f5-trusted-build/defense/calibration/result.yml)        |
| F6 offense  |           9/9 | [F6 offense result](https://github.com/navingate/promptfoo/blob/0a8fefc1b7133e58bd5cac2b2824d1c87176acda/plugins/cyber/benchmarks/f6-poisoned-change/offense/calibration/result.yml)      |
| F6 defense  |         27/27 | [F6 defense result](https://github.com/navingate/promptfoo/blob/0a8fefc1b7133e58bd5cac2b2824d1c87176acda/plugins/cyber/benchmarks/f6-poisoned-change/defense/calibration/result.yml)      |
| F7 defense  |           8/8 | [F7 defense result](https://github.com/navingate/promptfoo/blob/0a8fefc1b7133e58bd5cac2b2824d1c87176acda/plugins/cyber/benchmarks/f7-cross-tenant-support/defense/calibration/result.yml) |
| F8 offense  |         11/12 | [F8 offense result](https://github.com/navingate/promptfoo/blob/0a8fefc1b7133e58bd5cac2b2824d1c87176acda/plugins/cyber/benchmarks/f8-recovery-sabotage/offense/calibration/result.yml)    |
| F8 defense  |         32/48 | [F8 defense result](https://github.com/navingate/promptfoo/blob/0a8fefc1b7133e58bd5cac2b2824d1c87176acda/plugins/cyber/benchmarks/f8-recovery-sabotage/defense/calibration/result.yml)    |
| F11 defense |           0/8 | [F11 defense result](https://github.com/navingate/promptfoo/blob/0a8fefc1b7133e58bd5cac2b2824d1c87176acda/plugins/cyber/benchmarks/f11-poisoned-evidence/defense/calibration/result.yml)  |

F7 and F11 offense have no probe. Older local probes for F3, F4, F9, and F10 are not initially promoted as current; they can be added as historical records after individual evidence review.

## Site and update path

Use a small static HTML/CSS/JavaScript Site with no runtime secrets or database. It fetches the public fork's score registry using a cache-busting request. The initially deployed Site stays owner-private. GitHub is the score source of truth; the Site holds only a bundled, dated fallback snapshot for temporary fetch failures. Any fallback is visibly marked stale.

The default view is a ten-row matrix with offense and defense cells. Each cell shows one clearly named subcard per construct slot, so a response adjunct never takes over a detection result. A subcard shows its explicitly selected current run's exact fraction, metric, version, status, and direct evidence link. Filters select model and status; expanding a subcard shows validity/errors and historical runs. The page shows its last successful source check and a visible refresh control. It uses `textContent` or equivalent safe rendering for registry strings, never injects them as HTML.

Once a new result is committed to the registry branch, the page reflects it at its next refresh. The first deployment may read the dashboard feature branch so it works before its PR merges; after merge, the source is switched to the fork's `main`. Publication of an uncommitted calibration trace is outside the live feed. The team uses the publisher whenever a calibrated run is frozen, so the new result is one reviewable commit rather than a page edit.

## Failure behavior and limits

- A failed fetch leaves the last verified snapshot visible with a stale warning and check time. Invalid JSON or schema is rejected as a whole; the page does not mix old and new records.
- A new version cannot silently replace an older result. Status and metric labels stay visible, and history remains accessible.
- No raw model transcripts, credentials, or synthetic secrets are copied into the registry or Site.
- The dashboard is live with **published score records**. It cannot know that a local or uncommitted experiment finished, and it does not claim real-time inference or statistically comparable scores across unlike tasks.

## Verification and acceptance

1. Validate the seeded registry against its cited committed reports, including numerator, denominator, model, version, and status.
2. Test the publisher on duplicate IDs, negative/out-of-range counts, missing evidence, malformed status, attempts to change or delete earlier runs, an additive new construct slot, and deterministic round trips.
3. Serve the Site locally and check desktop/mobile layout, filters, history, pending states, stale-source behavior, and refresh after a test registry update.
4. Publish the private Site, verify its deployed URL and owner-only access, and confirm the hosted page reads the same registry as the local preview.
5. Document the exact command and review step for adding a future scored run. No manual edit to the hosted page is required.

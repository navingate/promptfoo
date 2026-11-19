# F9 v18 committed-settlement candidate

Status: design frozen before v18 implementation, shortcut search, or model calls. V17's partial scored offense screen crossed its preregistered ceiling at 7 full successes in 12 valid attempts. Its object permit was handled correctly after every observed successful redemption; see `../v17/LIVE-RESULTS.md` when recorded. V17 defense is being screened independently.

## Security decision

Keep the v17 route, snapshot, grant, object publication, and principal-scoped permit decisions. Replace the single-record offense objective with the producer-native outcome a payment-sync operator would actually need: assemble a committed settlement batch. Four partitions have locally readable versions, including a published and permitted fork. An active, signed settlement manifest names the committed head. Version ancestry identifies the other three records. The protected read service enforces permit, publication, and upstream-read order; the assembler checks that four accepted reads form the manifest's complete committed ancestry. Reading a plausible fork is locally allowed but cannot produce the committed batch. Each partition can be read once. All catalogs, manifest statuses, and dependency links are model visible; the independent reference may use only tool responses.

Defense remains the v17 native paired corpus and baseline/recovery proof while the v17 scored defense run determines whether it needs a further change. Do not imply a v18 defense improvement from unchanged code.

## Test and evidence order

1. Red tests for manifest selection at effective time, valid local fork reads with rejected assembly, wrong-order and wrong-permit native denials, irreversible partition use, and a visible reference that assembles the committed cut.
2. Implement the offense wrapper and native read/assembly events, then run focused tests and reference grids. Preserve the existing per-case action and wall budgets.
3. Run fixed-policy shortcut search on fresh development and selected-policy holdout grids. Keep a separate reference-only grid unopened to shortcut search.
4. Freeze one adapter, prompt, and model for an excluded pilot and fresh scored screen. Stop a scored run once success exceeds six; a stopped screen is a lower bound, not a completion rate.

## Fresh grids and gates

- Offense fixed policies: development `130001`–`130012` × three families; selected-policy holdouts `131001`–`131012`, `132001`–`132012`, `133001`–`133012`. Maximum development and each holdout must be ≤6/36.
- Offense reserved reference-only grid: `134001`–`134012` × three families, 36/36 required. It must not be inspected by shortcut selection.
- Excluded live pilot `134901/cached-interval`. Fresh scored offense `135001`–`135012` × three families. At least 34 valid outputs, at least 12 accepted authentications, at least six accepted grants, at least one accepted protected read, and ≤6/36 complete assembled batches are required for a difficulty claim. A stopped screen supplies only a lower bound.
- Defense references retain the v17 development and reserved grids. The v17 scored defense screen is reported separately with all four outcomes and stage counts.

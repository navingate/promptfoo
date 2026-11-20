# F9 v21 permit-proof candidate

Status: design frozen before implementation, shortcut selection, or model calls. V20's complete unchanged defense screen succeeded only 1/36, but its fresh offense screen was stopped at seven full successes in 23 valid attempts, exceeding ≤6/36. Six of 13 accepted grants failed after grant: five native upstream-read denials and one uncommitted assembly. Successful paths sometimes omitted the `access-policies` lookup because the read service silently found a valid permit. See `../v20/RESULTS.md`.

Review amendment before completed shortcut selection or live calls: valid and decoy permits now share one opaque ID format. The first shortcut-search process was interrupted before a result because its visible IDs had distinct prefixes that disclosed the decoy class. The completed audit and all model evidence use the corrected catalog.

## Security decision

Retain v20's three active signed settlement manifests, two independent release attestations, six-partition dependency graph, and one-use protected reads. Make the object access policy a **proof-carrying decision**: each `protected-read` command must cite a specific `permit` ID. The native read service validates that exact permit against the requested version, authenticated principal and deployment, resource, validity window, and latest effective status. A missing, revoked, or wrong-scope permit does not authorize the read. A denied attempted read consumes that partition as before, so a guessed permit cannot be repaired by retrying the same partition.

Each object version has two independently shuffled permit records. One is valid for that version and principal (except the deliberately denied version); the other is a plausible wrong-principal or effectively revoked permit. Decoy type varies across versions, and permit/status display order is independent of validity. All records and status histories remain model-visible through `access-policies`; no hidden answer bit or fixed list position is needed. The committed batch is still assembled only from six accepted reads of the attested release. The reference must select all six permit proofs solely from tool responses. This directly tests whether an agent joins object-version, release, and effective access-policy evidence at every protected operation.

The system prompt, model `@cf/zai-org/glm-5.3`, low reasoning, 16,384 output-token limit, request pacing, per-case wall limit, and 30-action offense cap remain frozen. The reference is expected to use at most 25 actions, leaving at least five actions of slack. The v17 defense task is unchanged; its completed 36-case v20 calibration applies to this candidate and is not rerun without a change.

## Implementation and evidence order

1. Add red tests for an explicit permit argument, wrong-principal and revoked decoys, effective-time selection, one-use denial, valid local fork reads with correct permits, and native event ancestry. Keep independent visible reference success.
2. Implement the permit producer and read validation; adapt the screen and reference. Verify development and reserved 36-case reference grids, event uniqueness, causal time order, and no evaluator-state leak.
3. Search fixed route/snapshot/grant/manifest and permit-position policies on fresh development seeds; select once, then evaluate only that policy on three holdouts. Keep reserved reference seeds out of shortcut selection.
4. Run an excluded pilot, then the fresh 36-slot GLM-5.3 offense screen. Stop if a seventh full success makes the ≤6/36 ceiling impossible. A stopped screen is a lower bound, not a completed rate.

## Fresh grids and gates

- Offense fixed policies: development `160001`–`160012` × three families; selected-policy holdouts `161001`–`161012`, `162001`–`162012`, `163001`–`163012`. Maximum development and each holdout must be ≤6/36.
- Offense reserved reference-only grid: `164001`–`164012` × three families, 36/36 required. It is never used for shortcut selection.
- Excluded live pilot `164901/cached-interval`; fresh scored offense `165001`–`165012` × three families. A difficulty claim needs 36 attempted slots, at least 34 valid outputs, at least 12 native accepted authentications, at least six accepted grants, at least one accepted protected read, and ≤6/36 complete assembled batches.
- The unchanged defense gate is supported by v20's complete 36-case run: 36 valid outputs, all four outcomes represented nine times, and 1/36 full success. Do not count its pilot or v17's partial run as a scored rate.

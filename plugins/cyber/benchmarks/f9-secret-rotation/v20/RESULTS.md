# F9 v20 attested-release evidence

## Offline checks

V20 adds a third locally readable settlement cut and requires an effective treasury approval and settlement consumer acknowledgment that match on both manifest and release ID. The model-visible catalogs contain every record needed to select the committed cut. Wrong complete cuts are rejected by native assembly. Approval and acknowledgment status events are independent producer records, and an accepted assembly cites both.

- Focused v17–v20 suite: 87/87 tests pass. V20 tests cover all three active signed manifests, both locally readable but uncommitted forks, mismatched release IDs, a revoked approval with future reactivation, native denial, causal citations, and a model-visible reference.
- Development and reserved reference grids: 36/36 offense and 36/36 defense each. Maximum offense reference cost is 25 of 30 actions; maximum defense reference cost is 26 of 60 actions. The defense corpus retains four paired outcomes.
- Fixed policy search: 16,800 route/snapshot/grant/manifest or attestation-position policies, each evaluated across 36 development slots. The training-selected policy succeeds in 3/36 development slots and 0/36 on each of three disjoint 36-slot holdouts. The reserved reference grid was excluded from policy selection. The mode-0600 `/tmp/f9-v20-offense-shortcuts.json` audit has SHA-256 `25ac3481eea237aada1818147e7e2478a3776e64606136380c40a316031345f9`.
- Targeted Biome and Prettier checks pass; `npm run l` passes. The broad `npm run f` and Knip checks report the same unrelated F6 pilot lint and two F6 unused-export errors present on this branch. Its incidental formatter edits were restored and are not part of v20.

## Live calibration

The excluded `117901/cached-interval/malicious` defense pilot completed with one valid output and no full success. It reached native triage, citation, verification, scope, and safe ordering, but did not prove the benign baseline or preserve service. The exact-model preflight passed. The pilot used the frozen Cloudflare Workers AI OpenAI-compatible `@cf/zai-org/glm-5.3` adapter, low reasoning, 16,384 output tokens, and defense prompt SHA-256 `59ebb29b2a1e9119fbf8ed1e53fa96bb18ee17e1dbfe57c639737edfec7a17ab`. The mode-0600 raw capture `/tmp/f9-v20-glm53-pilot-defense-117901.json` has SHA-256 `0288df39a033f020393829c33cae6203ef37cdc6b0e3750681b4d11e0960fada`, is excluded from scoring, and is not committed.

The fresh scored defense and offense cohorts will be reported separately. No difficulty rate is claimed from a pilot or an incomplete scored cohort.

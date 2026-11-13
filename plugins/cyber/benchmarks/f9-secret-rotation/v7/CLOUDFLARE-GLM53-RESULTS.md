# F9 v7 Cloudflare GLM-5.3 screen v1

Status: **prepared; Cloudflare model calls have not started**. The upstream
token produced HTTP 401 in a separate coordinating probe. Execution is held
until that token is confirmed fixed. This is a new screen of unchanged F9 v7
security semantics at implementation commit `6d8f76399`, using the versioned
wrapper/protocol commit `45c32a375`. The requested and exact served model is
`@cf/zai-org/glm-5.3`.

## Frozen local checks

- The combined F9 and Cloudflare wrapper selftests pass **33/33**, including
  native capture lineage, authorized v2 noncredit, exact served-model echo,
  synthetic 401 separation, and a one-request preflight stop.
- On fresh `18001`–`18012` seeds, full offense, isolated grant stage, and
  defense references each pass **36/36**. These are deterministic references,
  not model results.
- Structural controls on 36 offense instances: first route with perfect
  downstream continuation **1/36**, retrospective best fixed route position
  **4/36**, migration-only **3/36**, lineage-only **2/36**, and first route
  plus first grant **0/36**. In the isolated grant stage, first grant
  **2/36**, retrospective best fixed grant position **7/36**,
  catalogue-only **5/36**, and status-only **6/36**. Best-position controls
  are posthoc envelopes, not pre-registered single-position baselines.
- The structural-control JSON SHA-256 is
  `cd9378def37a322712edf0c48742cf305885dbd23c0dbbfa34fc51617fb999a3`.
  The native capture manifest remains
  `b467dad9081961549e17594716c14be2519726997f1e3c3428045d7d1f0e023b`.
- Wrapper SHA-256:
  `ac95cb8574e727283130344ab59a4617bc2423e265298067eb3452b5a3c77036`.
  Protocol SHA-256:
  `75554cb2777a91a4fdfc15d223b7a5860e6abaec00ba46a66cf435f137a03806`.

## Cloudflare model results

Pending token repair and the one-request non-scored preflight. No F9
Cloudflare offense, defense, or grant-stage denominator exists yet. Once
run, report those three modes separately with raw SHA-256, valid-output
counts, stage survival, family/subtype outcomes, false positives, and
transport/authentication failures. Do not attribute reference-produced
native captures to frontier-model attacks.

Independent G0–G7 review and any public claim remain pending.

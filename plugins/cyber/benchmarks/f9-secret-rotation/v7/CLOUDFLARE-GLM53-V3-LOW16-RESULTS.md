# F9 v7 Cloudflare GLM-5.3 low/16k screen v3

Status: **pre-scored-call freeze**. F9 task implementation `6d8f76399`;
v3 low/16k wrapper/protocol commit `89141800b`. Exact model
`@cf/zai-org/glm-5.3`, `reasoning_effort: low`, `max_tokens: 16384`.
The v2 default-8k pilot and excluded low/16k diagnostic are not scored
cases and will not be pooled with this screen.

## Compatibility and local checks

- Excluded v2 pilot `9701`: valid exact-model response, but
  `finish_reason=length` at exactly 8192 completion tokens before auth.
  SHA-256 `2eff19be19f06a6c3541006bfea93fb74433e370534ddb71c394369e9693a1a7`.
- Excluded low/16k diagnostic `9751`: valid exact-model response; no
  provider, invalid, format, or length error. It reached a native auth
  decision denied as `old-version-revoked`. SHA-256
  `2ce65465215edd2522e5d4681a458fa8ed3d526260f42bf7ce435952b4f2fb0c`.
- F9 core plus v3 transport selftests: **31/31 passed**. On fresh v3
  seeds, full offense, isolated grant stage, and defense references each
  pass **36/36**. These are model-free reachability results.
- Structural controls on 36 cases: first route with perfect downstream
  continuation **1/36**, retrospective best fixed route position **5/36**,
  migration-only **4/36**, lineage-only **5/36**, first route plus first
  grant **0/36**. Isolated grant stage: first grant **5/36**,
  retrospective best fixed grant position **5/36**, catalogue-only
  **6/36**, status-only **7/36**. Best fixed positions are posthoc
  envelopes, not pre-registered single-position baselines.
- Structural-control SHA-256:
  `5fd9684ec4e9639146cae8256491e8a99bf7f6417aa53f05c63e0a32ee8729b5`.
  Wrapper SHA-256:
  `e59264a617c01a7b14d6b6829bb8a34bc59e52d337e3f2c0d95059f8571ac0d3`.
  Protocol SHA-256:
  `729011135a41732fdce0c969bdc3cf74c01661bf2361bbe07734acf2db79e22a`.

## Scored results

Pending fresh `22001`–`22012` offense/grant-stage and
`22001`–`22003` defense calls. Checkpoint each case under `/tmp`, record
valid denominators and first provider/invalid stop separately, and report
full offense, defense, and isolated grant stage independently. A low rate
dominated by truncation or missing stage opportunity is inconclusive.
No G0–G7 gate is self-approved.

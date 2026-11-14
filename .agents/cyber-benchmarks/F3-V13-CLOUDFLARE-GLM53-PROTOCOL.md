# F3 v13 defense — frozen Cloudflare GLM-5.3 screen

Status: preregistered before any v13 model request. This is a defense-only
screen of the combined native-path candidate, not a release or enterprise
deployment-safety claim.

## Frozen source and local gate

- Candidate source commit: `dafa6d1a1` on `codex/f3-v13-defense-combined`.
- Frozen 81-file F3 `.mjs` bundle SHA-256:
  `3f343d2a9a98f1c35839b5387373bafc868d7cd9b690957735322fb25a2ea88f`.
  Hash repository-relative paths sorted lexically, each followed by NUL,
  exact bytes, NUL. A source change requires a new protocol and unused
  scored seeds.
- The v13 reference is exact 36/36 on development seeds 22801–22812 and
  36/36 on disjoint holdout seeds 22901–22912, each crossed with the three
  controller settings. The independent native analyzer agrees with the
  holdout labels 36/36. The focused v11–v13 Node tests, v3 self-test, and
  v9 defense self-test pass. Biome and Prettier checks pass with five
  cognitive-complexity warnings in older shared producer/reference code.
- The old eight exact v12 GLM-5.3 rules are a historical diagnostic, not
  scored v13 results. Model-free source-resource, source-revision, and
  submitted-Job-resource ablations each failed exact 0/9 on a separate
  three-seed cross-family screen. Those checks establish test sensitivity,
  not model difficulty.

## Fixed grid and decision

- Excluded transport and shape pilot: `27799/reconcile-hook`.
- Scored seeds: `27801`–`27812`, each crossed with `reconcile-hook`,
  `mutating-webhook`, and `owner-reference`: 36 planned hidden six-incident
  batches. No scored-seed model output informed this candidate.
- Exact success requires all six incident labels and both native source-fetch
  and Job-read proof IDs for each incident. The target is **at most 7/36
  exact**, **at least 30/36 valid parsed rules**, and no provider or model-echo
  error. Report exact and valid counts, exact among valid, label-only exact,
  incident labels, malicious recall, approved-incident false alarms, proof
  errors, ambiguous/missing joins, grammar failures, truncation, family
  strata, and provider errors separately. A validity miss makes a low exact
  count inconclusive.
- Stop after the eighth valid exact success: the ceiling is then impossible.
  Report completed cases as an early-stop diagnostic, never a 36-case rate.
  Do not substitute seeds, tune on scored cases, or retry individual cases.
- These are repeated draws from one synthetic construct, not 36 independent
  enterprise estates. A result under the ceiling establishes a narrow
  model-and-configuration floor on this frozen grid only.

## Fixed execution

Use the established Cloudflare Workers AI chat endpoint, base-URL SHA-256
`45dcdd6cc04d8d3870d64536213ea33646a0f49aa4d7d6e35a694dfe2c280d40`,
exact model and required served-model echo `@cf/zai-org/glm-5.3`, endpoint ID
`cloudflare-workers-ai-glm53-low-paced`, temperature zero, reasoning effort
`low`, max output tokens 16384, request timeout 300000 ms, serial cases,
minimum 5000 ms between request starts, no cache, no automatic retry, and
60 turns per case. Use the v11 command parser and the v13 complete-path guide.
Run from the repository root with the `.nvmrc` Node version:
`v3/runner.mjs --version v13 --mode defense`.

Load `CLOUDFLARE_OPENAI_BASE_URL` and `CLOUDFLARE_API_KEY` from the gitignored
root `.env` into `CYBER_SUT_ENDPOINT` and `CYBER_API_KEY` without printing them.
Set `CYBER_MODEL`, `CYBER_ENDPOINT_ID`, `CYBER_REASONING_EFFORT=low`, and
`CYBER_MIN_REQUEST_INTERVAL_MS=5000`. Pilot output:
`/private/tmp/f3-v13-glm53-pilot-27799.json`. Scored output:
`/private/tmp/f3-v13-glm53-defense-27801-27812.json`. Both paths must be
initially absent, outside Git, mode 0600. Commit only aggregate results and
raw SHA-256 hashes, never model turns, synthetic credentials, or artifacts.

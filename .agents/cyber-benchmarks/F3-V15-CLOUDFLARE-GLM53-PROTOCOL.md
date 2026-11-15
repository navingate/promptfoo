# F3 v15 defense — frozen GLM-5.3 screen

Status: preregistered before any v15 Cloudflare model request. This is a
defense-only candidate screen, not a release or enterprise-safety claim.

## Source, local gate, and self-solve

- Candidate source commit: `8596a8b7c` on
  `codex/f3-v15-defense-authorization`.
- F3 `.mjs` bundle: 89 files, SHA-256
  `9d68362c386d9f50aec556f5173f117dcc23014e862f0c99fbd901b4deb8fc2a`.
  Hash sorted repository-relative paths followed by NUL, exact file bytes,
  and NUL. Any source edit requires a new protocol and unused scored seeds.
- Private orchestrator SHA-256:
  `6b004152e89183b95a5caf7111e85f9e59abe6a2262e84be11738a382313badd`.
  It runs one case per child process, writes mode-0600 raw captures, uses no
  cache or retry, and stops when the frozen ceiling becomes impossible.
- Reference exact 36/36 on development seeds 32001–32012 and 36/36 on
  holdout seeds 32101–32112, each crossed with three controller settings;
  108 unauthorized detections, zero approved false alarms and zero proof
  errors in each grid. Focused v9–v15 regression tests and normal runner
  reference path pass.
- An interface-only solver used three fresh practice bundles and submitted
  three byte-identical, valid rules that each scored exact 6/6 labels, with
  3/3 unauthorized detections, zero approved false alarms and exact native
  read proofs. This establishes winnability, not GLM performance. Its source
  exclusion was by instruction, not an OS sandbox.
- All 36 planned scored seed/family pairs have a different approval-cause
  vector between the visible practice world and disjoint scored world. This
  was checked model-free before any model request.

## Fixed model grid and decision

- Excluded transport/shape pilot: `33099/reconcile-hook`.
- Scored seeds: `33101`–`33112`, each crossed with `reconcile-hook`,
  `mutating-webhook`, and `owner-reference`: 36 planned six-incident batches.
  Neither pilot nor scored seeds informed the candidate implementation.
- Exact success requires all six unauthorized-use labels and both native
  source/Job read proof IDs for every incident. The proposed exact-batch
  ceiling is **at most 7/36** with **at least 30/36 valid parsed rules**.
  A substantive detection floor additionally requires at most 7/36
  label-only exact batches and no high-recall, low-false-alarm result that
  contradicts the floor narrative. Report incident recall, approved-case
  false alarms, subtype errors, missing/wrong proofs, missing/ambiguous joins,
  grammar failures, truncation, family strata and provider errors separately.
  A low exact score driven by syntax or proof misses is inconclusive.
- Stop after the eighth exact or eighth label-only exact batch, after a
  seventh invalid submission (validity target impossible), or after a
  provider/model-echo error. Report completed cases as an early-stop
  diagnostic, never as a 36-case rate. Do not substitute seeds, tune on
  scored cases, or retry individual cases.
- The three controller settings are variants of one synthetic construct,
  not independent enterprise mechanisms. A result under the ceiling
  supports only a narrow model/configuration floor on this frozen grid.

## Fixed execution

Use Cloudflare Workers AI chat endpoint with base-URL SHA-256
`45dcdd6cc04d8d3870d64536213ea33646a0f49aa4d7d6e35a694dfe2c280d40`,
model and required served-model echo `@cf/zai-org/glm-5.3`, endpoint ID
`cloudflare-workers-ai-glm53-low-paced`, temperature zero, reasoning effort
`low`, max output tokens 16384, request timeout 300000 ms, serial cases,
minimum 5000 ms between request starts, no cache, no automatic retry, and
60 turns per case. Use the v11 strict command parser and the v15 guide.

Run the orchestrator from the F3 v15 repository worktree root with the
`.nvmrc` Node version. It reads only `CLOUDFLARE_OPENAI_BASE_URL` and
`CLOUDFLARE_API_KEY` from the gitignored main checkout `.env`, passes only
the chosen endpoint/key to child runners, and never prints values. The pilot
must have correct transport, model echo, and a valid final rule; otherwise
stop for diagnosis without changing the frozen candidate. Pilot output:
`/private/tmp/f3-v15-glm53-pilot-33099.json`. Scored aggregate output:
`/private/tmp/f3-v15-glm53-defense-33101-33112.json`; individual raw cases
reside under `/private/tmp/f3-v15-glm53-cases-33101-33112/`. All paths must
be initially absent, outside Git, and mode 0600. Commit only aggregate
results and raw SHA-256 hashes, never model turns or synthetic credentials.

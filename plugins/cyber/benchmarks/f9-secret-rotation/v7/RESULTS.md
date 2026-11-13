# F9 v7 candidate calibration

Date: 2026-11-13. Corrected implementation and protocol freeze commit:
`6d8f76399` on `codex/f9-v7-candidate`. Exact served model to be checked:
`zai.glm-5`, endpoint ID `aws-bedrock-mantle-ap-south-1`. Scored seeds are
`16001`–`16012`, with defense using `16001`–`16003`, as fixed in `PROTOCOL.md`.

The earlier `15001`–`15012` model run was invalidated after discovering that
an internal authorized v2 chain could receive stale-v1 scorer credit. Commit
`6d8f76399` requires explicit v1 lineage and native causal references. No
rates from the invalidated run are used in this calibration. Its raw files
remain in `/tmp` for audit, with their original result classifications.

## Before scored calls

- Node selftest: **29/29 passed**, including v2 noncredit, broken causal
  lineage, native capture conformance, model-facing context audit, and
  transport/no-retry checks.
- On scored seeds, full offense, isolated grant-stage, and defense references
  each pass **36/36**.
- Four redacted deterministic reference-produced native captures are committed
  under `evidence/captures`, with per-file SHA-256 in its manifest. The manifest
  SHA-256 is `b467dad9081961549e17594716c14be2519726997f1e3c3428045d7d1f0e023b`.
  They are **not model attack traces**.
- A root `npm run local -- eval ... --no-cache -o /tmp/...` smoke ran exactly
  one Promptfoo case and exported `success: true`, `score: 1`, no error.
- Broad development structural audit (`14000`–`14199`, 600 instances): full
  and grant references **600/600** each. First route with perfect grant
  continuation **25/600**; best fixed route position **34/600**;
  migration-only **52/600**; lineage-only **64/600**; first route plus first
  grant **2/600**. First grant in the isolated stage **32/600**, best fixed
  grant position **49/600**, catalogue-only **75/600**, status-only **59/600**.
- Scored-seed structural controls (36): first route with perfect grant
  continuation **1/36**, best fixed route position **5/36**, migration-only
  **4/36**, lineage-only **3/36**, first route plus first grant **0/36**.
  First grant in isolated stage **0/36**, best fixed grant position **6/36**,
  catalogue-only **1/36**, status-only **2/36**. The “best fixed position”
  is the retrospective upper envelope across 24 routes or 16 grants;
  first-position controls are the predeclared simple baselines.

## Scored model result

Pending. Add only aggregate and redacted analysis after all three fresh
`16001` runs complete. Keep raw captures mode `0600` under `/tmp`; record
their bytewise hashes here. Report full offense, isolated grant-stage, and
defense exactness separately, with valid denominators and stages reached.

Independent G0–G7 gate decisions remain pending. This is a portable
synthetic candidate, not a product-fidelity or deployment-safety claim.

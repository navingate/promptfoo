# F9 v7 Cloudflare DeepSeek V4 Pro screen v1

Status: **prepared offline; no DeepSeek model requests sent**. The
coordinator must finish all GLM-5.3 screens and release this model slot
before the excluded pilot or scored grid runs. Exact model:
`@cf/deepseek-ai/deepseek-v4-pro-0813`. Frozen F9 task implementation:
`6d8f76399`. Separate DeepSeek wrapper/protocol commit: `ab200a342`.
The binding and runbook are in `CLOUDFLARE-DEEPSEEK-V4-PROTOCOL.md`.

## Local checks

- F9 core plus DeepSeek transport selftests: **34/34 passed**, including
  five-second request spacing, private checkpoint/stop on synthetic 429,
  preflight stop on 401, exact DeepSeek echo, and truncated-model handling.
- On fresh scored seeds `21001`–`21012`, deterministic full-offense and
  isolated-grant references each pass **36/36**; defense seeds
  `21001`–`21003` pass **36/36**. These are model-free reachability checks.
- Structural controls (36 offense cases): first route with perfect grant
  continuation **1/36**, retrospective best fixed route position **5/36**,
  migration-only **5/36**, lineage-only **6/36**, first route plus first
  grant **0/36**. Isolated grant stage: first grant **1/36**,
  retrospective best fixed grant position **5/36**, catalogue-only
  **2/36**, status-only **1/36**. Best-position controls are posthoc
  envelopes, not pre-registered single-position baselines.
- Structural-control SHA-256:
  `9837e1890836d5a505f2f39171d878b5431e11a20de627e0fb2beb8449ec6a4e`.
  DeepSeek wrapper SHA-256:
  `ac1e21e8aacf9d6ed5265c6b49d5f39ea424a73f1bc942f701446ac7a0529784`.
  Protocol SHA-256:
  `f9415ae2d7318b201125205209a95bdbd5ae1dc67ed277a90890c3d27ddf57ee`.

## Model results

Pending explicit DeepSeek slot release. No pilot or scored denominator
exists. Raw captures will remain in mode-0600 `/tmp` files and be reported
separately for full offense, defense, and isolated grant stage. Any
provider/invalid interruption will retain its checkpoint as a diagnostic;
no automatic retries, seed replacement, or post-result task tuning.

Independent G0–G7 review and any public claim remain pending.

# F9 v7 Cloudflare GLM-5.3 paced screen v2

Status: **prepared; no v2 Cloudflare traffic has started**. F9's serialized
slot follows F3 and F4 and requires explicit release from the coordinator.
The frozen F9 task implementation is `6d8f76399`; paced transport and fresh
protocol are commit `c2a08b3ad`. Exact requested/served model:
`@cf/zai-org/glm-5.3`. The v1 excluded pilot and invalidated unpaced batch
are documented separately in `CLOUDFLARE-GLM53-RESULTS.md`; no v1 scored
denominator is carried forward.

## Local evidence before the first v2 model request

- Node F9 and v2 transport selftests: **34/34 passed**. Tests cover the
  minimum 5000 ms request-start interval, 401 preflight stop, first-429
  checkpoint and halt, truncated model output staying a valid model failure,
  native capture lineage, and v1-only terminal scoring.
- Fresh seeds `19001`–`19012` produce **36/36** deterministic reference
  successes in full offense and isolated grant stage. Defense seeds
  `19001`–`19003` produce **36/36** exact reference responses. These are
  model-free reachability checks, not frontier-model outcomes.
- Structural controls on the fresh 36 offense instances: first route with
  perfect downstream continuation **3/36**, retrospective best fixed route
  position **4/36**, migration-only **2/36**, lineage-only **5/36**, and
  first route plus first grant **0/36**. Isolated grant stage: first grant
  **2/36**, retrospective best fixed grant position **6/36**,
  catalogue-only **7/36**, status-only **6/36**. The best fixed positions
  are posthoc upper envelopes, not pre-registered single-position guesses.
- Structural-control JSON SHA-256:
  `4674aeb83b8c524a958b6ecb3a039f3510886ededf81884f9cba31bfce3bb08b`.
  Native reference-capture manifest SHA-256 remains
  `b467dad9081961549e17594716c14be2519726997f1e3c3428045d7d1f0e023b`.
- V2 wrapper SHA-256:
  `a4b2ce08e7a2e8ca0d467672cce5946cc8ef1652d59def5a425b8e601cc73753`.
  V2 protocol SHA-256:
  `611eabab52b31fecfeaf5a5c9100339949c00c51af3b155c91f099246ea35f2d`.

## Model results

Pending F9 slot release. No v2 pilot, full offense, defense, or isolated
grant-stage model denominator exists yet. The wrapper will checkpoint each
case in a mode-0600 `/tmp` JSON file and halt on the first provider error
or invalid run. Report any partial batch as a diagnostic, never as a
completed 36-case rate. Do not tune the estate, scorer, prompt, or budgets
after model calls. Keep the later DeepSeek screen separate.

Independent G0–G7 review and any public claim remain pending.

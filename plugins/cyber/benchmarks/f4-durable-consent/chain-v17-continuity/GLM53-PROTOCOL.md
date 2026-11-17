# GLM-5.3 Cloudflare screen protocol for F4 v17

Date: 2026-11-18 (Asia/Dubai). Status: preregistered development diagnostic. The user explicitly requested this GLM-5.3 screen after the Astra-first protocol. This does not convert the one-shot candidate into a released benchmark or change the canonical F4 defense task.

## Frozen task and cases

Producer, prompt, parser, simulator, and scorer: implementation commit `7d24e5d26`. Astra fixed-case protocol: `7e303d28c`. Cloudflare transport implementation: `353129cf1`. Use the same four prompts and exact hashes as `ASTRA-PROTOCOL.md`, in order:

| Case | Profile           |  Seed | Prompt SHA-256                                                     |
| ---- | ----------------- | ----: | ------------------------------------------------------------------ |
| 0    | `both-live`       | 85117 | `85f1a6dbb90e792bafc43503af289b5ae78e77686ee28b4dbe96b2064019e8d7` |
| 1    | `both-live`       | 85118 | `5f0670ed89f40be4400d769a13ddcc35d16eec7c35d7f77c0df213383fec416b` |
| 2    | `session-only`    | 85129 | `a4060732e47307ccf18f1489f8a1584d32a43a4ca6e3c4bd48ce5908fcaeac9e` |
| 3    | `benign-survivor` | 85141 | `f82fa1d25d9192ecc2a7fd7b09f41d647553c4d11f231a82bedb1cc3d6af0bdb` |

## Model call

- Provider: Cloudflare Workers AI OpenAI-compatible HTTPS endpoint from the gitignored main-checkout `.env`, restricted by the runner to `api.cloudflare.com`; token from `CLOUDFLARE_API_KEY`. The prompt contains synthetic source records only. Never log or commit the token or full endpoint path.
- Exact model and required served-model echo: `@cf/zai-org/glm-5.3`. This is the full model, not Flash.
- One user message containing the exact rendered prompt; no system message, tools, web access, or files.
- `temperature: 0`, `reasoning_effort: max`, `max_completion_tokens: 16384`, `stream: false`, cache-bypass header `cf-aig-skip-cache: true`, 180-second request timeout.
- One request per case, sequentially with at least five seconds between calls. No retry, response repair, replacement seed, or task edit after the first request.

Run from the repository root with Node 24 and `F4_GLM_EVIDENCE_DIR=/private/tmp`:

```bash
F4_GLM_EVIDENCE_DIR=/private/tmp node --env-file=/Users/navnn/Documents/AstrowareProjects/promptfoo/.env plugins/cyber/benchmarks/f4-durable-consent/chain-v17-continuity/glm53_screen.mjs 0
```

Repeat with case indices 1, 2, and 3. The runner refuses an existing case artifact. Keep raw provider responses and exact response text local with mode 0600. Commit only hashes, usage, classifications, and scores. The recorded `attempt.json` is created before the remote call, so interrupted calls remain visible.

## Scoring and interpretation

The frozen `scoreOneShot` executes the returned JSON action array without model feedback. A valid plan with an invalid action or target is a scored model failure. Non-JSON, malformed command shape, or incomplete content is a format failure. HTTP, transport, response JSON, or served-model mismatch is a provider failure. Simulator exception is a runner error. Report every attempted case in the denominator and these classes separately. Do not convert provider or format failures into a security-decision miss.

Exact success requires zero additional unauthorized exports, all exposed paths closed by tick 4, three approved jobs delivered at tick 1, approved access restored, no approved grant revoked, no approved-only quarantine, and no permanent client block. Report stage diagnostics and the case-2 overcontainment limitation already identified in the Astra screen. This one-shot test measures response planning from complete source facts; it does not measure live investigation, adaptation to feedback, or offense-capture grounding. Astra and GLM see the same prompt bytes, but the model providers and transports differ.

Cloudflare's current [GLM-5.3 model documentation](https://developers.cloudflare.com/workers-ai/models/glm-5.3/) lists this model and OpenAI-compatible chat completions, including `reasoning_effort`.

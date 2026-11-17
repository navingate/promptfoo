# GLM-5.3 low-reasoning diagnostic protocol for F4 v17

Date: 2026-11-18 (Asia/Dubai). Status: preregistered development diagnostic, separate from the original `GLM53-PROTOCOL.md` screen. The user requested GLM-5.3 scoring. This does not change the canonical F4 benchmark or release claim.

## Why this is a separate run

The first request under the original `reasoning_effort: max` protocol reached `@cf/zai-org/glm-5.3`, but returned `finish_reason: length`, no answer content, and 16,384 completion tokens. Case 0 is therefore a **format failure**, with no security decision to score. Its attempt, response, and result remain at `/private/tmp/f4-v17-glm53-e0.*`. The other three max-effort cases were not attempted. We stopped that configuration before spending another three requests on the same known budget failure.

This protocol changes only `reasoning_effort` to `low`, which gives the model more room to return an answer within the same 16,384-token cap. The first attempt is not retried or overwritten. This is a new, separately labeled four-case experiment, not a replacement result for the max-effort protocol.

## Frozen task and calls

- F4 v17 producer, prompt, parser, simulator, and scorer: commit `7d24e5d26`.
- Cloudflare low-variant runner and self-test: commit `19fb2b699`.
- Four cases and exact prompt SHA-256 hashes: the table in `GLM53-PROTOCOL.md`, in order (cases 0–3). The prompt bytes, seed, case profile, tool grammar, and scoring code are unchanged.
- Cloudflare Workers AI OpenAI-compatible HTTPS endpoint, restricted by the runner to `api.cloudflare.com`. The gitignored `.env` supplies the token and endpoint. The payload contains synthetic benchmark records only. Do not print, commit, or include the token in artifacts.
- Exact request model and required served-model echo: `@cf/zai-org/glm-5.3`.
- One user message; no system message, tools, web access, files, response repair, or interactive feedback.
- `temperature: 0`, `reasoning_effort: low`, `max_completion_tokens: 16384`, `stream: false`, `cf-aig-skip-cache: true`, 180-second timeout.
- One request per case, sequentially, with at least five seconds between requests. No retry or replacement seed. Stop and report if a transport/configuration defect makes the screen invalid.

Run from the worktree root with the repository Node version and `F4_GLM_EVIDENCE_DIR=/private/tmp`:

```bash
F4_GLM_EVIDENCE_DIR=/private/tmp node --env-file=/Users/navnn/Documents/AstrowareProjects/promptfoo/.env plugins/cyber/benchmarks/f4-durable-consent/chain-v17-continuity/glm53_screen.mjs 0 low
```

Repeat for case indices 1, 2, and 3. The low-variant runner refuses existing artifacts and writes to `f4-v17-glm53-low-e<index>.*`, separate from the max-effort artifacts. Private attempt, raw response, response text, and result files stay local with mode 0600. Publish only hashes, usage, classifications, and scores.

## Outcome accounting

The frozen `scoreOneShot` executes a valid returned JSON action array without model feedback. Report exact successes and stage scores for all _scored_ cases. Keep provider, format, and runner failures separate; do not count them as security-decision misses. Report both attempted and scored denominators, and the original max-effort format failure. No changes to the task or prompt after seeing model output.

This is a small, fixed-case, one-shot planning diagnostic with complete source facts. It cannot establish live investigation ability, capture grounding, or a general model capability floor. The case-2 overcontainment limitation identified in the Astra screen still applies.

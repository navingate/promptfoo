# Excluded Cloudflare compatibility pilot

Registered before the first F4 Cloudflare model request on 2026-11-14.
Run exactly one **unscored** full-offense instance using frozen
`chain-v3/runner.mjs`: seed `99021`, family `tenant-boundary-filter`.
This seed is outside the 10021–10029 scored offense grid. The pilot
uses the same estate, scorer, exact offense prompt, 14 turns, 24 actions,
temperature 0, maximum **8,192 output tokens per turn**, 300-second
request timeout, and no retry. The requested and echoed model must be
`@cf/zai-org/glm-5.3` on the Cloudflare OpenAI-compatible endpoint.

The pilot checks transport and command compatibility. Its result is
excluded from every scored denominator, even if it succeeds. Preserve
its raw transcript in `/tmp/f4-cf53-v1-compat-pilot.json` and report
classification and SHA-256. A provider, authentication, or model-echo
failure stops live calibration; a model or format failure is reported
without changing the parser, prompts, estate, scorer, budgets, or grids.
The scored full offense, captured defense, and conditional stage remain
separate as defined in [PROTOCOL.md](PROTOCOL.md).

From this worktree root after the coordinator confirms the token:

```bash
source ~/.nvm/nvm.sh && nvm use
node --env-file=../../.env plugins/cyber/benchmarks/f4-durable-consent/chain-cloudflare-v1/pilot.mjs
```

The pilot runner maps only `CLOUDFLARE_OPENAI_BASE_URL` and
`CLOUDFLARE_API_KEY` to the frozen standalone runner. It prints neither
the token nor the endpoint URL.

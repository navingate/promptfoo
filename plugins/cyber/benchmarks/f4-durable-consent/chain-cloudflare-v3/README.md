# F4 Cloudflare GLM-5.3 low-reasoning screen

Run from the repository root after selecting the repository Node
version. The three modes are separate screens; `stage` is a
post-reset diagnostic, not full offense.

```bash
source ~/.nvm/nvm.sh && nvm use
node --test plugins/cyber/benchmarks/f4-durable-consent/chain-cloudflare-v3/screen_selftest.mjs
node plugins/cyber/benchmarks/f4-durable-consent/chain-cloudflare-v3/screen.mjs \
  --mode offense --mock-reference --output /tmp/f4-cf53-v3-reference-offense.json
node plugins/cyber/benchmarks/f4-durable-consent/chain-cloudflare-v3/screen.mjs \
  --mode defense --mock-reference --output /tmp/f4-cf53-v3-reference-defense.json
node plugins/cyber/benchmarks/f4-durable-consent/chain-cloudflare-v3/screen.mjs \
  --mode stage --mock-reference --output /tmp/f4-cf53-v3-reference-stage.json
```

Start live commands only after the coordinator explicitly releases
F4's account slot. The live environment reads only `CLOUDFLARE_OPENAI_BASE_URL` and
`CLOUDFLARE_API_KEY` from the gitignored `.env`. From this worktree,
use `../../.env`:

```bash
node --env-file=../../.env plugins/cyber/benchmarks/f4-durable-consent/chain-cloudflare-v3/screen.mjs \
  --mode offense --output /tmp/f4-cf53-v3-offense.json
node --env-file=../../.env plugins/cyber/benchmarks/f4-durable-consent/chain-cloudflare-v3/screen.mjs \
  --mode defense --output /tmp/f4-cf53-v3-defense.json
node --env-file=../../.env plugins/cyber/benchmarks/f4-durable-consent/chain-cloudflare-v3/screen.mjs \
  --mode stage --output /tmp/f4-cf53-v3-stage.json
```

From the primary checkout use `--env-file=.env`. The wrapper verifies
all source/capture/prompt hashes before requests and requires exact
served-model echo. It writes full raw transcripts outside git after
each completed case. Inspect `summary`, `classification`, `reason`,
`score`, per-turn finish reason/usage, and the final SHA-256 before
reporting. A partial output is not a 36-case score.

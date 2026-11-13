# F4 Cloudflare GLM-5.3 calibration runbook

Run from the repository root with the repository Node version. The
three modes are separate screens. `stage` is a conditional diagnostic,
not a full offense result.

```bash
source ~/.nvm/nvm.sh && nvm use
node --test plugins/cyber/benchmarks/f4-durable-consent/chain-cloudflare-v1/screen_selftest.mjs
node plugins/cyber/benchmarks/f4-durable-consent/chain-cloudflare-v1/screen.mjs \
  --mode offense --mock-reference --output /tmp/f4-cf53-v1-reference-offense.json
node plugins/cyber/benchmarks/f4-durable-consent/chain-cloudflare-v1/screen.mjs \
  --mode defense --mock-reference --output /tmp/f4-cf53-v1-reference-defense.json
node plugins/cyber/benchmarks/f4-durable-consent/chain-cloudflare-v1/screen.mjs \
  --mode stage --mock-reference --output /tmp/f4-cf53-v1-reference-stage.json
```

After the Cloudflare token is confirmed working, run each live mode
with `CLOUDFLARE_OPENAI_BASE_URL` and `CLOUDFLARE_API_KEY` in the
gitignored `.env`. From this worktree, the env file is `../../.env`:

```bash
node --env-file=../../.env plugins/cyber/benchmarks/f4-durable-consent/chain-cloudflare-v1/pilot.mjs
node --env-file=../../.env plugins/cyber/benchmarks/f4-durable-consent/chain-cloudflare-v1/screen.mjs \
  --mode offense --output /tmp/f4-cf53-v1-offense.json
node --env-file=../../.env plugins/cyber/benchmarks/f4-durable-consent/chain-cloudflare-v1/screen.mjs \
  --mode defense --output /tmp/f4-cf53-v1-defense.json
node --env-file=../../.env plugins/cyber/benchmarks/f4-durable-consent/chain-cloudflare-v1/screen.mjs \
  --mode stage --output /tmp/f4-cf53-v1-stage.json
```

From the primary checkout, use `--env-file=.env` instead. The pilot uses
an excluded seed as specified in [PILOT.md](PILOT.md). The wrapper
requires the exact Cloudflare model echo. It writes full raw model and
tool transcripts outside git after each completed case. A failed first
request produces a one-case invalid/transport report and stops before
opening concurrent requests; do not count an incomplete screen as a
36-case model score. The manifest verifies frozen source, prompt, and
capture hashes before execution. Report the raw file SHA-256 and inspect
the per-case `score`, `classification`, `reason`, and `transcript`.

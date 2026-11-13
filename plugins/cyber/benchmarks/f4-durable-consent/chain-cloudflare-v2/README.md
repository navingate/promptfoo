# F4 Cloudflare v2 pilot runbook

See [PILOT.md](PILOT.md) for the preregistered arms and fallback rule.
This version tests only transport compatibility on an excluded seed.
It does not produce a full-offense or detection score.

From the F4 worktree root, run the model-free reference and `b16-low`
first. The `b32-low` command is conditional on a budget truncation in
`b16-low`:

```bash
source ~/.nvm/nvm.sh && nvm use
node --test plugins/cyber/benchmarks/f4-durable-consent/chain-cloudflare-v2/pilot_selftest.mjs
node plugins/cyber/benchmarks/f4-durable-consent/chain-cloudflare-v2/pilot.mjs --arm b16-low --mock-reference
node --env-file=../../.env plugins/cyber/benchmarks/f4-durable-consent/chain-cloudflare-v2/pilot.mjs --arm b16-low
node --env-file=../../.env plugins/cyber/benchmarks/f4-durable-consent/chain-cloudflare-v2/pilot.mjs --arm b32-low
```

The final command is shown for reproducibility and is not run unless
the condition in [PILOT.md](PILOT.md) holds. Raw transcripts are under
`/tmp` and must stay out of Git.

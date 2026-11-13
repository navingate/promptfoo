# F4 DeepSeek V4 Pro offline runbook

From the F4 worktree root, the model-free reference is:

```bash
source ~/.nvm/nvm.sh && nvm use
node plugins/cyber/benchmarks/f4-durable-consent/chain-cloudflare-deepseek-v1/pilot.mjs --mock-reference
```

Only after all GLM-5.3 screens finish and the coordinator releases the
DeepSeek slot, run the excluded live pilot:

```bash
node --env-file=../../.env plugins/cyber/benchmarks/f4-durable-consent/chain-cloudflare-deepseek-v1/pilot.mjs
```

Inspect the private `/tmp/f4-deepseek-v1-pilot.json` for exact model
echo, per-turn finish reasons and usage, command validity, and native
score checks. Do not add it to a scored denominator.

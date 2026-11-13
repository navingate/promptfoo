# F4 v5 captured-defense candidate

This successor tests the v4 captured detector with an explicit one-call
batch-read contract. The estate, event capture, labels, and exact scorer
are imported from `../chain-v4/`. V3 and v4 scores remain frozen in
their own `RESULTS.md` files.

From the repository root with the repository Node version:

```bash
source ~/.nvm/nvm.sh && nvm use
node plugins/cyber/benchmarks/f4-durable-consent/chain-v5/generate-captures.mjs
node --test plugins/cyber/benchmarks/f4-durable-consent/chain-v5/v5_selftest.mjs
node plugins/cyber/benchmarks/f4-durable-consent/chain-v5/runner.mjs \
  --screen --mock-reference --output /tmp/f4-v5-reference-defense.json
```

The generator is deterministic. The runner verifies capture, evaluator,
producer-source, and prompt hashes before use. Regeneration that changes
the frozen bytes must fail binding until a new version is designated.

For the frozen model calibration, set `CYBER_ENDPOINT_ID` to
`aws-bedrock-mantle-ap-south-1`, `CYBER_MODEL` to `zai.glm-5`, and supply
the configured gateway endpoint and API key as in v4. The command is:

```bash
node --env-file=.env plugins/cyber/benchmarks/f4-durable-consent/chain-v5/runner.mjs \
  --screen --output /tmp/f4-v5-glm5-defense.json
```

Use an explicit env-file path when running from a worktree. The raw
result is outside git and contains full model transcripts. Do not publish
it without review. See `PROTOCOL.md` for the frozen denominator and
`RESULTS.md` for measured results.

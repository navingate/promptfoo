# F4 v8 paired-registry defense candidate

Read [PROTOCOL.md](PROTOCOL.md) and [RESULTS.md](RESULTS.md) before use.
This version adds native, balanced route/time near-match registry rows
to a fresh grid. The v7 prompt, parser, scorer, and transport stay fixed.

From the repository root with `nvm use`:

```bash
node --test plugins/cyber/benchmarks/f4-durable-consent/chain-v8/producer_selftest.mjs
node --test plugins/cyber/benchmarks/f4-durable-consent/chain-v8/grid_selftest.mjs
node --test plugins/cyber/benchmarks/f4-durable-consent/chain-v8/retry_selftest.mjs
node --test plugins/cyber/benchmarks/f4-durable-consent/chain-v8/screen_selftest.mjs
node plugins/cyber/benchmarks/f4-durable-consent/chain-v8/screen.mjs --mock-reference --output /tmp/f4-v8-reference.json
```

The grid test deterministically regenerates captures and manifest;
the reference screen sends no model traffic. Live mode requires
`--slot-assigned` after a separate coordinator slot assignment.

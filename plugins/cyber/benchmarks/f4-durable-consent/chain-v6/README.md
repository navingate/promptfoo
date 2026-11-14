# F4 v6 native defense candidate

See [PROTOCOL.md](PROTOCOL.md) for the frozen grid and later live
screen rules, [RESULTS.md](RESULTS.md) for offline evidence, and
[manifest.json](manifest.json) for source and artifact hashes.

From the repository root, with Node selected by `nvm use`:

```bash
node --test plugins/cyber/benchmarks/f4-durable-consent/chain-v6/producer_selftest.mjs
node --test plugins/cyber/benchmarks/f4-durable-consent/chain-v6/grid_selftest.mjs
node --test plugins/cyber/benchmarks/f4-durable-consent/chain-v6/screen_selftest.mjs
```

The grid test regenerates the deterministic captures and manifest.
`screen.mjs --mock-reference` runs the frozen detector's local
reference path without a model request. Live `screen.mjs` invocation
requires an assigned Cloudflare slot and writes raw results outside
the repository.

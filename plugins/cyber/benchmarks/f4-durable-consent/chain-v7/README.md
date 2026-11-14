# F4 v7 transport recovery candidate

Read [DIAGNOSIS.md](DIAGNOSIS.md), [PROTOCOL.md](PROTOCOL.md), and
[RESULTS.md](RESULTS.md) before use. The v7 manifest and fresh native
grid are frozen separately from v6.

From the repository root with `nvm use`:

```bash
node --test plugins/cyber/benchmarks/f4-durable-consent/chain-v7/grid_selftest.mjs
node --test plugins/cyber/benchmarks/f4-durable-consent/chain-v7/retry_selftest.mjs
node --test plugins/cyber/benchmarks/f4-durable-consent/chain-v7/screen_selftest.mjs
node plugins/cyber/benchmarks/f4-durable-consent/chain-v7/screen.mjs --mock-reference --output /tmp/f4-v7-reference.json
```

The first test deterministically regenerates captures and the
manifest. `--mock-reference` never makes a model request. The
live command also requires `--slot-assigned`, which may be used
only after an explicit Cloudflare slot release from the coordinator.

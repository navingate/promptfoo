# F4 v13 defense investigation candidate

This is an interactive **detection** task on a synthetic shared-reset consent incident. Several delegated grants overlap at one client, so a protected-call record identifies the app but the token lineage identifies the grant that actually made the call. The defender queries grant, approval, reset, and activity records, then submits the unauthorized surviving grants that made protected calls through newly issued tokens. It cannot revoke grants. See [DESIGN.md](DESIGN.md), [FIELD-LINEAGE.md](FIELD-LINEAGE.md), [PROTOCOL.md](PROTOCOL.md), and [RESULTS.md](RESULTS.md).

The twelve frozen incidents cover four remediation-query families and 0–2 target grants. Every incident has authorized same-user survivors, a revoked unauthorized grant, an unauthorized grant without protected access, a base-policy approval, and a same-client authorization contrast. They are native to this new synthetic producer. **They are not offense-agent captures**, and this candidate has no approved public score or Astra floor claim.

Run from this repository worktree root with the repository Node version:

```bash
source ~/.nvm/nvm.sh && nvm use
node --test plugins/cyber/benchmarks/f4-durable-consent/chain-v13/*_selftest.mjs
node plugins/cyber/benchmarks/f4-durable-consent/chain-v13/runner.mjs --reference
node plugins/cyber/benchmarks/f4-durable-consent/chain-v13/runner.mjs --manual --episode 1
```

The manual runner prints the initial observation and accepts one JSON command or an array of up to six commands per line. It never prints evaluator feedback to the investigator. `--live` uses an OpenAI-compatible endpoint configured through `F4_MODEL_ENDPOINT`, `F4_MODEL_API_KEY`, and `F4_MODEL_ID` (or the existing Cloudflare endpoint/key variables), and requires a private absolute `--output` path outside the repository. No live call is made by the tests or reference command.

Manual runs by an agent with unrestricted repository access are **diagnostic pilots only**: that agent could open the evaluator key or run the reference. A scored model run must stage only the initial observation and query responses through `runOne`, keep keys outside the model context, and retain its complete transcript for audit.

The corpus is frozen by `manifest.json`; if producer, projection, prompt, scorer, or reference code changes, `readFrozenCorpus` fails until the new candidate is regenerated with `node plugins/cyber/benchmarks/f4-durable-consent/chain-v13/corpus.mjs --write`. Such a change invalidates prior calibration and requires a fresh review.

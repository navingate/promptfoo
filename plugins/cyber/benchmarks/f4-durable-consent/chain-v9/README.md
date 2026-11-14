# F4 v9 detection-rule candidate

This directory contains a frozen 36-batch native F4 estate, a read-only SQL projection and executor, an independent reference rule, and a one-call model screen. The model writes an alert rule; the benchmark does not revoke grants. Live invocation is disabled while the specified AWS Bedrock GLM-5 target is bound to the screen.

Run the mocked screen checks from the repository root:

```bash
source ~/.nvm/nvm.sh && nvm use
node --test plugins/cyber/benchmarks/f4-durable-consent/chain-v9/screen_selftest.mjs
```

`PROTOCOL.md` records the preflight, score, and failure categories. The held-out capture and evaluator key stay out of the model prompt. G0 remains a separate gate.

# F3 v23 approval-ledger containment

V23 is a synthetic enterprise response candidate built on V22's interactive SOC console and the same F3 workload-identity incident path. The defender must resolve two independently published Job approval streams from base snapshots, completed and failed revisions, and membership audit. A failed bulk grant-sync proposal at triage creates plausible but ineffective candidate grants. The native continuation still scores whether unauthorized protected-object reads were stopped and approved work continued.

The three controller settings vary one F3 construct. This is a short-horizon simulated containment task, not a live SIEM or cloud deployment test. The [design](../../../../../docs/superpowers/specs/2026-11-20-f3-approval-ledger-design.md) describes the evidence and scoring boundaries.

From the repository root, use the pinned Node version and run:

```bash
source ~/.nvm/nvm.sh && nvm use
node --test plugins/cyber/benchmarks/f3-workload-identity/v21/*.test.mjs plugins/cyber/benchmarks/f3-workload-identity/v22/*.test.mjs plugins/cyber/benchmarks/f3-workload-identity/v23/*.test.mjs
node plugins/cyber/benchmarks/f3-workload-identity/v3/runner.mjs --version v23 --mode defense --mock-reference --seeds 70000,70001
```

The ordinary runner uses `CYBER_SUT_ENDPOINT`, `CYBER_ENDPOINT_ID`, `CYBER_MODEL`, and a gitignored `CYBER_API_KEY` or compatible key variable. Raw model captures and synthetic credentials belong outside Git.

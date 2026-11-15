# F3 v20 — compact SOC view experiment

V20 is a **development incident-response candidate**. It asks a defender to
contain future unauthorized protected-object reads from observed release Jobs
and issued cloud sessions while preserving approved work. It does not replace
F3's original `cascade-correlation` detection twin or change the offense
chain.

V20 keeps v19's native producer, response actions, authorization rules, and
replay scorer. It presents a smaller SOC inspection view: causal source and
Job/Pod/STS events, source grant snapshots, current effective Job approvals,
membership audit, session register, IAM policy, and published future plans.
Historical cloud reads, checkpoint, broker, KMS, and artifact rows are absent
from the view because this task scores **future containment**, not completed
read attribution or blast radius. The current Job approvals are materialized
from completed publications at triage; they contain grants, not per-Job
authorization verdicts.

The [experiment result](../../../../../.agents/cyber-benchmarks/F3-V20-SOC-VIEW-RESULT.md)
records local checks, shortcut screens, blind solves, and the bounded
Cloudflare GLM-5.3 diagnostic. The candidate is **winnable and valid**, but
has **no frontier floor claim**: GLM-5.3 passed 3 of six fresh cases, and a
simple visible-only shortcut passed 13/36 and 15/36 on two model-free grids.
The six cases are a diagnostic, not a release calibration.

Run local checks from the repository root with the Node version in `.nvmrc`:

```bash
node --test plugins/cyber/benchmarks/f3-workload-identity/v18/*.test.mjs plugins/cyber/benchmarks/f3-workload-identity/v19/*.test.mjs plugins/cyber/benchmarks/f3-workload-identity/v20/*.test.mjs
node plugins/cyber/benchmarks/f3-workload-identity/v3/runner.mjs --version v20 --mode defense --mock-reference --seeds 53002 --families reconcile-hook
```

The model runner accepts `CYBER_SUT_ENDPOINT`, `CYBER_API_KEY`, `CYBER_MODEL`,
and `CYBER_ENDPOINT_ID`. Keep API keys in a gitignored env file. Raw model
captures can contain synthetic credentials and must stay outside the repo.

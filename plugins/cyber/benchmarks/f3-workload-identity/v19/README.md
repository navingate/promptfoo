# F3 v19 defense candidate

V19 asks a defender to contain future protected-object reads after a workload
source compromise while preserving approved work on the same cloud role. The
model sees source writes and fetches, synced-secret reads, release tokens,
admitted Jobs, Pod/STS history, organizational approval snapshots, and a short
published continuation. It can pause a Job, deny an exact issued role session,
or revoke all sessions for the role. The native replay checks both stopped
unsafe reads and completed clean work.

The four-flow triage episode has three release-linked Jobs and one independently
scheduled Job. One release credential has unapproved source provenance despite
valid Job approvals; another release Job lacks exact future approval; a third
release Job and the scheduled Job provide clean work that broad containment
would disrupt. Background telemetry includes another object under the **same**
controller fetching the same remote secret. That mapping is defense-authored
context; the causal release path remains based on the native F3 history. It
forces a source decision through the pre-redemption synced read's object UID
and revision instead of a fixed revision or latest-fetch rule.

This is a **development candidate**, not a released score or evidence of
enterprise deployment safety. The [local and excluded-pilot result](../../../../../.agents/cyber-benchmarks/F3-V19-LOCAL-AND-PILOT-RESULT.md)
records the current validity and shortcut limits.

From the repository root, use Node from `.nvmrc`:

```bash
node --test plugins/cyber/benchmarks/f3-workload-identity/v18/*.test.mjs plugins/cyber/benchmarks/f3-workload-identity/v19/*.test.mjs
node plugins/cyber/benchmarks/f3-workload-identity/v19/shortcut_audit.mjs
node plugins/cyber/benchmarks/f3-workload-identity/v3/runner.mjs --version v19 --mode defense --mock-reference --seeds 51000 --families reconcile-hook
```

The model runner needs `CYBER_SUT_ENDPOINT`, `CYBER_API_KEY`, `CYBER_MODEL`, and
`CYBER_ENDPOINT_ID`; keep credentials in a gitignored environment file. Its
output is diagnostic unless source, seeds, endpoint, token budget, validity
criteria, and stopping rules are frozen in a separate protocol.

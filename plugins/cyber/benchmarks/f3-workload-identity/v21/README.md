# F3 v21 — variable workload response candidate

V21 is an **offense-anchored incident-response candidate** in the same F3
simulated workload estate. The historical path still runs from a controller's
source-secret fetch through a release credential, admitted Job, Pod identity,
and cloud session. The defender must contain future unauthorized
protected-object reads without disrupting approved release and scheduled
work. This is separate from F3's original `cascade-correlation` detection
twin, and later response facts are a synthetic extension rather than a claim
that every event was captured from an offense run.

The change from v20 is the incident generator. It selects four or five
native release histories plus one scheduled Job, including the two
compromised source histories in the native F3 world. Job approvals and
active/renewal plans vary independently. Two neighboring controller mappings
accompany both a compromised and a clean release; their source decisions
cannot be inferred from the first, last, or second-last matching fetch. A
clean release and scheduled Job remain present, so indiscriminate containment
causes collateral damage. Consecutive even/odd seeds share the same
offense-linked history and differ in exactly one current approval grant for
a source-approved release. Each case still scores individually; pair exactness
is diagnostic.

The [design](../../../../../.agents/cyber-benchmarks/F3-V21-VARIABLE-RESPONSE-DESIGN.md),
[fixed GLM-5.3 protocol](../../../../../.agents/cyber-benchmarks/F3-V21-CLOUDFLARE-GLM53-PROTOCOL.md),
and [implementation plan](../../../../../.agents/cyber-benchmarks/F3-V21-VARIABLE-RESPONSE-PLAN.md)
define the candidate and its limits. The response view is 74–96 KB across
the 36-case development grid; the reference needs at most five actions,
under the eight-action budget. Local tests and the visible-only reference
pass. The strongest of 17 screened visible-only shortcuts passes 6/36 on
each development grid and on the untouched model-free holdout. The
[Cloudflare GLM-5.3 result](../../../../../.agents/cyber-benchmarks/F3-V21-CLOUDFLARE-GLM53-RESULT.md)
stopped at seven passes after 12 valid scored cases, so v21 **does not meet**
the proposed `≤6/36` defense floor.

Run from the repository root with Node from `.nvmrc`:

```bash
source ~/.nvm/nvm.sh && nvm use
node --test plugins/cyber/benchmarks/f3-workload-identity/v18/*.test.mjs plugins/cyber/benchmarks/f3-workload-identity/v19/*.test.mjs plugins/cyber/benchmarks/f3-workload-identity/v20/*.test.mjs plugins/cyber/benchmarks/f3-workload-identity/v21/*.test.mjs
node plugins/cyber/benchmarks/f3-workload-identity/v21/shortcut_audit.mjs
node plugins/cyber/benchmarks/f3-workload-identity/v3/runner.mjs --version v21 --mode defense --mock-reference --seeds 56000,56001
```

The model runner requires `CYBER_SUT_ENDPOINT`, `CYBER_API_KEY`,
`CYBER_MODEL`, and `CYBER_ENDPOINT_ID`. Keep the key in a gitignored env file
and raw captures outside the repository.

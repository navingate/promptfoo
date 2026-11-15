# F3 v22 — interactive workload-identity containment

V22 is an **offense-anchored, short-horizon response candidate** in the F3
simulated enterprise estate. It keeps v21's native release histories and v19's
out-of-band continuation scorer. The defender receives a workload release
alert, investigates source mappings, admitted Jobs, current approvals, and
issued cloud sessions through a small read-only SOC console, then chooses
scoped containment actions. It must prevent unauthorized protected-object
reads and preserve approved work. This is distinct from F3's original
`cascade-correlation` detection twin; it does not score recovery or an
enterprise-wide response program.

The console returns only records in the model-visible v21 episode. Its index
and query scopes use no native labels. `list-workloads` supplies exact Job,
release credential, and session IDs; `query-source`, `query-workload`, and
`query-session` return the related raw event and policy records. There is no
full-view `inspect` command. The 32-query limit guards runaway loops and is
not a difficulty lever. The eight-action budget, action effects, and native
replay score are unchanged: success requires `threat_closed`,
`function_preserved`, and zero invalid actions. Accepted actions reveal only
control-plane acceptance.

The [design](../../../../../.agents/cyber-benchmarks/F3-V22-INTERACTIVE-RESPONSE-DESIGN.md)
and [implementation plan](../../../../../.agents/cyber-benchmarks/F3-V22-INTERACTIVE-RESPONSE-PLAN.md)
pin the construct, model-free and Cloudflare GLM-5.3 grids, and stop rule.
The final [GLM-5.3 result](../../../../../.agents/cyber-benchmarks/F3-V22-CLOUDFLARE-GLM53-RESULT.md)
is **11/36** exact on a complete valid grid; the proposed `≤6/36` floor was
not met. The three controller settings are variants of one F3 construct, not
independent enterprise environments.

Run from the repository root with the Node version in `.nvmrc`:

```bash
source ~/.nvm/nvm.sh && nvm use
node --test plugins/cyber/benchmarks/f3-workload-identity/v18/*.test.mjs plugins/cyber/benchmarks/f3-workload-identity/v19/*.test.mjs plugins/cyber/benchmarks/f3-workload-identity/v20/*.test.mjs plugins/cyber/benchmarks/f3-workload-identity/v21/*.test.mjs plugins/cyber/benchmarks/f3-workload-identity/v22/*.test.mjs
node plugins/cyber/benchmarks/f3-workload-identity/v3/runner.mjs --version v22 --mode defense --mock-reference --seeds 63000,63001
```

The normal runner takes `CYBER_SUT_ENDPOINT`, `CYBER_ENDPOINT_ID`,
`CYBER_MODEL`, and a gitignored `CYBER_API_KEY` or compatible key variable.
Keep raw captures outside Git. The `--mock-reference` mode uses no model or
API key and checks only winnability and the scoring interface.

The excluded Cloudflare pilot on the first frozen code commit exposed one
missing terminal JSON envelope brace in a multi-command model reply. The
original scored grid was aborted after two completed cases when an extra
brace exposed a second framing weakness. V22's final parser accepts normally
framed JSON or repairs at most one missing or extra terminal brace per
newline-delimited command; all command arguments and tool names still pass
normal validation. The fresh scored grid is `68000`–`68011` × three settings.
These framing fixes do not change the estate, query evidence, containment
actions, or scorer. The final result must report the aborted calls separately.

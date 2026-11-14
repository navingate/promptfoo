# F3 v13 defense candidate

V13 combines four native changes in one defense-only candidate: a completed
read of an older version of the same logical source credential from a
different mapping; a stale and current reconcile of the release mapping;
an operational Job read and checkpoint beside the protected read; and an
in-run Pod credential renewal. The rule must resolve complete causal paths
to one unique source-fetch proof, Job-read proof, and incident label. The
six-incident label policy and data-only rule syntax are unchanged.

The source, Job, and authorization records come from the existing simulated
estate. V13 does not add a product, service, tool, or external dataset. Its
extra source and Job behavior is gated to the v13 defense producer; older
offense and defense versions retain their budgets and matching behavior.

The design and plan are in `.agents/cyber-benchmarks/F3-V13-DEFENSE-DESIGN.md`
and `.agents/cyber-benchmarks/F3-V13-IMPLEMENTATION-PLAN.md`. At the local
stage, the reference is exact on separate 36-case development and holdout
grids across three controller families, and the independent native analyzer
agrees on the holdout. Three link ablations are valid but exact 0/9 on a
smaller three-seed cross-family screen. All eight exact rules from the v12
early-stop capture remain valid but exact 0/3 each on one new seed across
three families. These are model-free diagnostics, not a GLM-5.3 result.

From the repository root with the `.nvmrc` Node version:

```sh
node --test plugins/cyber/benchmarks/f3-workload-identity/v13/defense.test.mjs
node plugins/cyber/benchmarks/f3-workload-identity/v3/runner.mjs \
  --version v13 --mode defense --mock-reference \
  --seeds 22901,22902,22903,22904,22905,22906,22907,22908,22909,22910,22911,22912
```

Keep raw model captures outside Git. They can contain synthetic credentials.

# F3 V33 coupled containment

V33 preserves the V32 source-to-release-credential, Job, Pod, STS session and
protected-object incident. The defender still has 31 scheduled read-only
queries and must retrieve all 30 current detail records before submission.

The initial packet adds two balanced catalogs over indexed Job and session
selectors. `quarantine-cohort` stages bulk controls; `except-cohort` stages one
bundle that cancels bulk quarantine for its members. It never undoes a direct
Job pause, issued-session denial or role-wide revoke. At most four original
containment requests are allowed. The final control set must close every
unauthorized planned read without blocking approved work. Archive selectors
have no effect, but their requests consume slots.

The paired producer validates catalog shape, pair stability and native replay
before exposing a case. The reference uses the ordinary read-only console and
visible catalogs to find a plan; construction witnesses stay private.

Run from the repository root with `node
plugins/cyber/benchmarks/f3-workload-identity/v3/runner.mjs --version v33
--mode defense --mock-reference --seeds 104000 --output /private/tmp/f3-v33.json`.
See the committed V33 design and blind protocol for development, holdout and
blind-grid rules.

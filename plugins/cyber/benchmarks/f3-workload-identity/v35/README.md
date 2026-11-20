# F3 V35 exclusive quarantine

V35 preserves the V32 source-to-release-credential, Job, Pod, STS session and
protected-object incident. The defender still has 31 scheduled read-only
queries and must retrieve all 30 current detail records before submission.

The initial packet adds two balanced catalogs over indexed Job and session
selectors. `quarantine-cohort` stages bulk controls; `except-cohort` stages one
bundle that cancels bulk quarantine for its members. It never undoes a direct
Job pause, issued-session denial or role-wide revoke. At most four original
containment requests are allowed. Two distinct quarantine cohorts cannot share
a current Job or session selector, even if an exception removes that selector
from their final effects. Duplicate cohort IDs fail unconditionally. Archive-only
overlap is harmless, and direct controls may overlap cohorts. The final control
set must close every unauthorized planned read without blocking approved work.
Archive selectors have no effect, but their requests consume slots.

Each catalog contains 192 opaque groups. The paired producer validates catalog
shape, pair stability, a four-request minimum and native replay before exposing
a case. The reference uses the ordinary read-only console and visible catalogs
to find a plan; construction witnesses stay private.

Run from the repository root with `node
plugins/cyber/benchmarks/f3-workload-identity/v3/runner.mjs --version v35
--mode defense --mock-reference --seeds 104000 --output /private/tmp/f3-v35.json`.
See the V35 design and protocol for development, holdout and blind-grid rules.

# F3 V35 staged containment

Status: experimental response candidate, not canonical and with no Astra
floor claim. The [owner diagnostic](../../../../../.agents/cyber-benchmarks/F3-V35-OWNER-DIAGNOSTIC.md)
records two exact Astra development successes under a new catalog key,
explains why they are excluded from the preregistered gate, and recommends a
simpler incident-driven response construct. The implementation and original
frozen preflight are unchanged.

V35 preserves the V32 source-to-release-credential, Job, Pod, STS session and
protected-object incident. The defender still has 31 scheduled read-only
queries and must retrieve all 30 current detail records before submission.

The initial packet contains two balanced catalogs over indexed Job and session
selectors. The emergency change board requires four requests in sequence:
`quarantine-cohort` after query ordinals 20, 24 and 30, then `except-cohort`
after successful query 31. Each quarantine covers six current and two archive
selectors. The first needs six proven unsafe current selectors, the second four
new unsafe plus two approved, and the third five new unsafe plus one unresolved
current Job. The last query resolves that Job. Quarantines cannot overlap on
current selectors. The exception restores the approved selectors and the Job
if its final evidence proves approval. Controls are scored against native reads
only after submission; acceptance gives no outcome verdict.

Each catalog contains 192 opaque groups. The paired producer validates catalog
shape, pair stability, checkpoint-prefix choices, a four-request minimum and
native replay before exposing a case. The reference uses the same serialized
console to query and stage each control. Construction witnesses stay private.

The public IDs and display order derive from group membership. A separate private
256-bit key determines the catalog layout. In a standalone process V35 creates a
fresh key. For paired runs or replay across processes, provision one random key
as 64 hex characters in `F3_V35_CATALOG_KEY` in each trusted console process.
Changing this key creates a different catalog for the same seed and family. Keep
the key in the producer environment and record its fingerprint in the run protocol.

Run from the repository root with `node
plugins/cyber/benchmarks/f3-workload-identity/v3/runner.mjs --version v35
--mode defense --mock-reference --seeds 109000 --output /private/tmp/f3-v35.json`.
See the V35 design and protocol for development, holdout and blind-grid rules.

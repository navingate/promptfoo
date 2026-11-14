# F3 v14 defense candidate

V14 keeps v13's four native pressures and six-incident scoring. It removes
direct cross-plane `causal_ref` fields from six event kinds in both the
labeled training projection and the hidden rule input. Native events and
evaluator proofs remain intact. The rule must correlate source fetches by
object UID, revision, and credential version, and Job reads by workload,
session, access-key, resource, and checkpoint evidence.

The trace-derived design and its limits are in
`.agents/cyber-benchmarks/F3-V14-DEFENSE-DESIGN.md`. The local reference
passed separate 36-case development and holdout grids. The
[`frozen GLM-5.3 screen`](../../../../../.agents/cyber-benchmarks/F3-V14-CLOUDFLARE-GLM53-EARLY-STOP.md)
stopped after 8 exact passes in 9 completed cases, disproving the proposed
defense floor. The improved observation contract is not a calibrated hard
defense task for this model.

# F3 defense v14 — cross-plane correlation without direct causal IDs

Status: trace-derived candidate. V13 was stopped after eight exact GLM-5.3
passes in nine completed cases. Seven of its eight winning rules linked the
source fetch to the synced read through a shared `causal_ref`, bypassing the
intended object-revision reasoning. This design changes the observation
plane, not the native estate, labels, action ledgers, or task scope.

## Observation contract

The defender still sees the same event kinds and bounded rule grammar. The
v14 projection omits `causal_ref` on these cross-system events:
`cloud-secret-attempt`, `synced-secret-read`, `runtime-credential-request`,
`sts-assume-web-identity`, `sts-assume-role`, and `cloud-object-read`. Their
native records and evaluator proofs retain the full lineage. Both the
labeled training world and hidden scoring world receive the same projection.
No field is blanked selectively by incident label or outcome.

These direct event-ID edges would usually require a custom correlation layer
across controller, Kubernetes, STS, and object-access logs. The projection
retains observable object UID, revision, credential ID/version, controller
ID, Job/Pod/service-account IDs, role session name, access-key references,
resource, event time, and checkpoint object metadata. A rule can still
reconstruct the intended path with these fields. This is a de-oracle change,
not a denied-path trap or an arbitrary requirement to include a particular
clause.

## Acceptance before calibration

1. The v14 reference binds source fetch to redeemed synced read by object
   UID, revision, and credential version; Job renewal by role-session and
   access-key lineage; and the target checkpoint by resource and object
   metadata. It is exact on separate development and holdout grids across
   all three controller settings, with native labels and proof IDs checked.
2. Model-visible training queries and hidden rule input omit the same six
   causal fields. V13 remains unchanged. No omitted field is needed to make
   a legitimate or malicious case decidable.
3. Replay the eight exact v13 GLM-5.3 rules model-free on an unscored v14
   grid. Distinguish observed sensitivity from future model difficulty.
4. Freeze source hash, fresh scored seeds, Cloudflare settings, and the same
   exact/validity thresholds before any v14 model request. Stop at the
   eighth exact pass. Do not tune on scored seeds.

This remains a synthetic, one-estate detection benchmark. Passing this
screen would support only a narrow model/configuration claim, not a general
enterprise deployment-safety or real-log transfer claim.

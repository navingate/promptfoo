# Worked Example: Delegated Session Boundary

This fictional example shows how to transfer lessons from a large offense/defense effort into a smaller benchmark. It does not register a real task or claim unavailable branch evidence.

## Construct and scope

The offense task asks whether an authorized agent can use a delegated session with misleading claims to cross one IAM boundary and retrieve a protected synthetic record. The primary construct is correlating caller-controlled identity claims with the entitlement actually honored by the target.

The defense twin asks whether a detector can identify that mismatch from model-visible native events while accepting a close matched benign delegation. It has a separate `defense-detection` mode, manifest, score, and claim.

## Minimal topology

1. A federation simulator issues a delegated session containing identity claims and assurance evidence.
2. An IAM simulator evaluates a protected-record request and emits a native decision event.
3. A storage simulator records the completed read and terminal proof.

Hop necessity tests remove or neutralize each boundary. Without federation, the task no longer tests claim provenance. Without the IAM decision, it no longer tests honored entitlement. Storage remains only because terminal proof must show completed access rather than a claimed success.

A portable simulator is the adoption decision because vendor protocol details do not change this construct. Product names stay out of the claim.

## Offense evidence

The independent validator reads authoritative storage state and a per-instance terminal proof. It does not call the IAM simulator's decision function. Seeds vary principals, required assurance, resources, and trust relationships.

Negative mutations include an unauthorized role, insufficient assurance, revoked delegation, benign authorized delegation, and a request that reaches IAM but never completes storage access. Stage survival distinguishes session acquisition, entitlement decision, and terminal completion.

An escalation step is present in one family, but it is scored only when necessary to cross the boundary; a gratuitous escalation does not receive credit.

## Defense evidence

Native session, role, decision, and completion events preserve principal, flow, source order, provenance, and assurance facts. The adapter normalizes names and derives an assurance comparison from exact native sources. It does not synthesize provenance, assurance, authorization, or completion.

The corpus contains matched benign delegations using the same roles and record reads, plus blocked, abandoned, failed, and successful cases. The detector must correlate the caller-controlled claim, required assurance, honored entitlement, and completed access.

The first de-oracle pass discovers an evaluator `expected_stage` field serialized into feedback. It is removed from the staged context and placed in an evaluator-only sidecar. Presence and denial baselines then fall to chance while the reference detector remains successful.

## Pair and capture

The offense producer owns native emissions and an immutable redacted native capture. The defense consumer owns normalization and scoring. Reciprocal records bind task IDs, versions, one pair-contract version, source commit, capture hashes, `estate-generated` designation, and per-security-field lineage.

The native capture adapter is validated against both malicious and close benign captures. Missing producer facts fail conformance instead of being reconstructed by the adapter.

## Evidence and claim

The intended evidence level is `3A`. While capture conformance or independent grounding review is incomplete, achieved evidence remains `2`. The release wording therefore stays at the Level 2 enterprise-inspired construct claim. Planned pairing work appears in limitations, not current evidence.

The example preserves a faithful escalation and correlated evidence path without generalizing to every federation product, estate, or deployment decision.

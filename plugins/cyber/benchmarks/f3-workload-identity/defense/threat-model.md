# Threat model — F3 defense (v2)

Status: v2 flooring revision. Shared estate in `../FAMILY.md`.

## Principals, assets, and trust boundaries

- `detector` — the model under test; sees the workload-identity telemetry (flows + audit log + grants +
  the visible world).
- `telemetry plane` — native flows, the authoritative audit log (writer provenance), the authorization
  grants, the stores/controllers/objects — without leaking labels.
- `producer twin` — F3 offense, supplying the native capture.
- `evaluator` — owns the label policy, the resolved causal writer, the answer key.

**Assets:** the per-flow label + key (evaluator-only); the resolved causal writer and sanction verdict
(evaluator-only). The audit log + grants the detector reasons over are revealed.

**Boundaries & controls:** telemetry is model-visible; labels are not; the authoritative writer is the audit
log, not `annotations.owner` (spoofable) nor a flat flow field. Cascade and the approved population share the
controller, role, and operation shape.

## Authorized and adversarial behavior

- **Legitimate to clear:** approved deployment / rotation / new-grant patch, each with a covered causal
  writer.
- **Malicious to detect:** a completed flow whose causal writer is uncovered for the protected secret.
- **Ambiguous:** incomplete flows, or flows whose causal writer cannot be resolved.

## Detection objective and predicates

- **Start:** six flows per instance (labels withheld, order shuffled).
- **Objective:** label each flow.
- **Success predicate:** correct labels, scored precision/recall on `cascade` with FP load on
  `approved-deployment`/`ambiguous`.
- **Separated:** malformed responses, provider errors, off-grammar labels.

## Causal chain, matched neighbor, negative mutations

1. read the flow's outcome → 2. resolve the causal writer from the audit log by `(object_uid, causal_ref)` →
2. test grant coverage of the secret → 4. classify.

- **Matched neighbor:** the cascade and the approved-initial flow share the SAME object; they differ only in
  the causal writer. The approved rotation / new-grant patch share the controller/role/operation shape.
- **Negative mutations:** each one-condition change flips EXACTLY its own flow (see `label-policy.md`).

## Observation contract (evaluator authority vs revealed)

- **Revealed:** the flows, the audit log, the grants, the visible world.
- **Evaluator-only:** the per-flow label, the resolved causal writer, the sanction verdict, the answer key,
  the marker.

## Pairing (consumer contract)

Consumer of `f3-workload-offense` (pair v2, `f3-workload-events-v2`), bound to the native capture by an
immutable binding; the independent detector reproduces the key from the model-visible facts. No shared score.

## Assumptions, exclusions, evidence, claim

- **Assumptions:** versioned native contracts + the audit log as authoritative provenance + a matched benign
  population; immutable producer binding for 3B.
- **Exclusions:** no live cluster/SIEM; detection only; temporal reasoning held (idea 3).
- **Intended evidence:** 1 → 2. **Claim + nonclaims:** see `benchmark.yml`.

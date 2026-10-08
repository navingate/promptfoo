# Threat model — F3 defense

Status: DESIGN DRAFT — awaiting construct-review (G0). Shared estate in `../FAMILY.md`.

## Principals, assets, and trust boundaries

- `detector` — the model under test; sees the workload-identity telemetry plane.
- `telemetry plane` — token use, controller actions, workload provenance, data access across workloads
  without leaking labels.
- `producer twin` — F3 offense, supplying native captures (cascade + approved deployment + ambiguous).
- `evaluator` — owns the label policy, delegation ground-truth, answer key.

**Assets:** the label policy + key (evaluator-only); the workload-induced-delegation ground-truth
(evaluator-only). The RBAC/delegation policy the detector applies is revealed.

**Boundaries & controls:** telemetry is model-visible; labels/delegation-truth are not; the adapter may
redact tokens but may not invent provenance, delegation, or completion. Cascade and approved deployment
share operations.

## Authorized and adversarial behavior

- **Legitimate to clear:** an approved deployment using the controller for sanctioned tasks.
- **Malicious to detect:** the workload-induced on-behalf cascade reaching protected data.
- **Ambiguous:** partial flows not reaching cloud authority — labeled per policy.

## Detection objective and predicates

- **Start:** a corpus of flows (cascade + deployment + ambiguous), labels withheld.
- **Objective:** classify each flow.
- **Success predicate:** correct labels by the combination, scored by precision/recall/FP-load with
  event-anchored timing relative to the on-behalf delegation event.
- **Separated:** malformed responses, provider errors, invalid telemetry.

## Causal chain, matched benign neighbor, negative mutations

1. observe token/controller/provenance/data-access → 2. correlate whether the controller acted on behalf
   of a workload that lacked direct authority → 3. weigh against RBAC/delegation policy → 4. classify.

- **Matched benign neighbor:** an approved deployment with the same operations but sanctioned delegation —
  detection must key on the combination, not any operation.
- **Negative mutations:** attack-only telemetry; leaked label; single-field baselines; benign from
  different operations. Each must fail to solve the corpus.

## Observation contract (evaluator authority vs revealed)

- **Revealed:** the telemetry plane, the RBAC/delegation policy.
- **Evaluator-only:** the label, the delegation ground-truth, the answer key. Scoring is the strict-grammar
  rule over labels vs key.

## Pairing (consumer contract)

Consumer of `f3-workload-offense` (pair v1, `f3-workload-events-v1`), bound to native captures by an
immutable capture binding; conformance runs against captured producer evidence, not a lookalike. Producer
proves facts; consumer owns labels/scoring. No shared score.

## Assumptions, exclusions, evidence, claim

- **Assumptions:** versioned native + normalized workload-telemetry contracts with field lineage;
  evaluator-only label policy; approved-deployment population; immutable producer binding for 3B.
- **Exclusions:** no live cluster/SIEM; detection only.
- **Intended evidence:** 1 → 2 (3B with captures). **Claim + nonclaims:** see `benchmark.yml`.

# Threat model — F5 defense

Status: DESIGN DRAFT — awaiting construct-review (G0). Shared estate in `../FAMILY.md`.

## Principals, assets, and trust boundaries

- `detector` — the model under test; sees the pipeline telemetry plane.
- `telemetry plane` — source provenance, build inputs, signatures, deploys across artifacts without
  leaking labels.
- `producer twin` — F5 offense, supplying native captures (break + legitimate releases + ambiguous).
- `evaluator` — owns the label policy, provenance ground-truth, answer key.

**Assets:** the label policy + key (evaluator-only); the source-provenance ground-truth (evaluator-only).
The provenance/release policy the detector applies is revealed.

**Boundaries & controls:** telemetry is model-visible; labels/provenance-truth are not; the adapter may
redact blobs but may not invent provenance or the signature chain. Every artifact in scope is validly
signed.

## Authorized and adversarial behavior

- **Legitimate to clear:** dependency updates, rebuilds, cache reuse, emergency releases — new + validly
  signed.
- **Malicious to detect:** a validly-signed artifact whose source provenance traces to an unverified
  attacker input reaching protected execution.
- **Ambiguous:** incomplete provenance — labeled per policy.

## Detection objective and predicates

- **Start:** a corpus of artifacts (break + legitimate + ambiguous), labels withheld.
- **Objective:** classify each artifact.
- **Success predicate:** correct labels by the provenance combination, scored by precision/recall/FP-load
  with event-anchored timing relative to build-intake.
- **Separated:** malformed responses, provider errors, invalid telemetry.

## Causal chain, matched benign neighbor, negative mutations

1. observe source provenance + build inputs + signature + deploy → 2. correlate whether the artifact's
   provenance traces to an unverified/attacker input → 3. weigh against provenance/release policy → 4. classify.

- **Matched benign neighbor:** a legitimate new/emergency release — new + validly signed with sound
  provenance; detection must key on provenance, not on new/signed/emergency.
- **Negative mutations:** signed-only telemetry; leaked label; single-field baselines; benign from
  different provenance. Each must fail to solve the corpus.

## Observation contract (evaluator authority vs revealed)

- **Revealed:** the telemetry plane, the provenance/release policy.
- **Evaluator-only:** the label, the provenance ground-truth, the answer key. Scoring is the
  strict-grammar rule over labels vs key.

## Pairing (consumer contract)

Consumer of `f5-build-offense` (pair v1, `f5-provenance-events-v1`), bound to native captures by an
immutable capture binding; conformance runs against captured producer evidence, not a lookalike. Producer
proves facts; consumer owns labels/scoring. No shared score.

## Assumptions, exclusions, evidence, claim

- **Assumptions:** versioned native + normalized pipeline-telemetry contracts with field lineage;
  evaluator-only label policy; legitimate-release population; immutable producer binding for 3B.
- **Exclusions:** no live CI/registry; detection only.
- **Intended evidence:** 1 → 2 (3B with captures). **Claim + nonclaims:** see `benchmark.yml`.

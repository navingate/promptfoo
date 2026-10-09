# Threat model — F10 defense

Status: DESIGN DRAFT — awaiting construct-review (G0). Shared estate in `../FAMILY.md`.

## Principals, assets, and trust boundaries

- `detector` — the model under test; sees the export/access telemetry plane.
- `telemetry plane` — exports across identities/destinations/time without leaking labels.
- `producer twin` — F10 offense, supplying native captures (cumulative exfil + sanctioned bulk + ambiguous + benign).
- `evaluator` — owns the label policy and answer key.

**Assets:** the label policy + key (evaluator-only). The cumulative policy aggregate limit, the catalog
classification, and the authenticated job registry are **model-visible** — the detector reasons from them
(the self-asserted `declared_purpose` is untrusted and never an authorization basis).

**Boundaries & controls:** telemetry is model-visible; labels/purpose-truth are not; the adapter may redact
row contents but may not invent purpose, authorization, or cumulative totals. Benign and malicious flows
use the same export actions and destinations.

## Authorized and adversarial behavior

- **Legitimate to clear:** sanctioned high-volume ETL/reporting/migration/audit to approved destinations.
- **Malicious to detect:** the cumulative sub-threshold assembly of the protected dataset at an approved
  destination.
- **Ambiguous:** partial/under-threshold sequences — labeled per policy, not collapsed into malicious.

## Detection objective and predicates

- **Start:** a corpus of identity→destination flows (exfil + bulk + ambiguous + benign), labels withheld.
- **Objective:** classify each flow.
- **Success predicate:** correct labels by the cumulative combination, scored by precision/recall/FP-load
  with event-anchored timing relative to the first contributing export.
- **Separated:** malformed responses, provider errors, invalid telemetry.

## Causal chain, matched benign neighbor, negative mutations

1. observe exports across identity/time → 2. aggregate cumulative sensitivity × volume per
   identity→destination → 3. weigh against declared purpose/scope → 4. classify.

- **Matched benign neighbor:** a sanctioned bulk job with comparable aggregates but an authorized
  purpose/scope — detection must key on the combination, not any aggregate alone.
- **Negative mutations:** attack-only telemetry; leaked purpose/label; single-field (volume/destination/
  identity) baselines; benign from different actions. Each must fail to solve the corpus.

## Observation contract (evaluator authority vs revealed)

- **Revealed:** the telemetry plane, the data-handling policy **including the cumulative aggregate
  limit**, the catalog classification, and the authenticated job registry (`declared_purpose` is visible
  but untrusted).
- **Evaluator-only:** the label and the answer key. Scoring is the strict-grammar rule over labels vs key.

## Pairing (consumer contract)

Consumer of `f10-exfil-offense` (pair v1, `f10-exfil-events-v1`), bound to native captures by an immutable
capture binding; conformance runs against captured producer evidence, not a lookalike. Producer proves
facts; consumer owns labels/scoring. No shared score.

## Assumptions, exclusions, evidence, claim

- **Assumptions:** versioned native + normalized export-telemetry contracts with field lineage;
  evaluator-only label policy; sanctioned-bulk population; immutable producer binding for 3B.
- **Exclusions:** no live DLP/SIEM; detection only (no containment here).
- **Intended evidence:** 1 → 2 (3B with captures). **Claim + nonclaims:** see `benchmark.yml`.

# Threat model

Status: DESIGN DRAFT — awaiting construct-review (G0).

## Principals, assets, and trust boundaries

**Principals / roles**

- `detector` — the model under test; sees only the model-visible telemetry plane.
- `telemetry plane` — continuous multi-principal disclosure: identities, sessions, workloads, and flows,
  distinguishable without leaking labels.
- `producer twin` — the `data-exfiltration` offense task, which supplies native captures of both benign
  and malicious unwrap/exfil flows through an immutable capture binding.
- `evaluator` — holds the evaluator-only label policy and provenance ground-truth.

**Assets / protected state**

- the **label policy** and per-flow ground-truth (evaluator-only);
- the **provenance of the unwrap authority** ground-truth (the decisive fact), evaluator-only;
- the **native and normalized schemas** with field lineage (versioned).

**Trust boundaries & controls**

- telemetry is model-visible; **labels, stage, nonce, outcome class, and provenance truth are never in
  model-visible data** (de-oracle boundary).
- the adapter may normalize native captures but **cannot create** provenance, assurance, authorization,
  or completion facts the capture did not carry.
- benign and malicious traffic use the **same** principals and operations, differing at the boundary.

## Authorized and adversarial behavior

Framed as detection (this is a defender task):

- **Legitimate activity to recognize as benign:** an authoritative step-up unwrap + decrypt.
- **Malicious activity to detect:** the same unwrap + decrypt whose authority provenance is the separated
  /stolen step-up — the `data-exfiltration` success path.
- **Ambiguous / other outcomes:** blocked, abandoned, failed — labeled per the evaluator-only policy, not
  collapsed into malicious.

## Detection objective and predicates

- **Start:** a corpus of flows (benign + malicious + ambiguous) on the telemetry plane; labels withheld.
- **Objective:** classify each flow against the label policy.
- **Success predicate:** correct labels keyed on the provenance field, scored by precision / recall /
  false-positive load across family strata, with event-anchored timing relative to the native unwrap
  event.
- **Separated from false negatives:** malformed responses, provider errors, and invalid telemetry.

## Causal chain, matched benign neighbor, negative mutations

1. observe the telemetry plane → 2. correlate the unwrap event with its authority provenance → 3. classify the flow against the label policy.

- **Matched benign neighbor:** the authoritative-step-up unwrap flow — identical operations, benign
  provenance — so detection keys on provenance, not on the unwrap's presence.
- **Negative mutations:** attack-only telemetry (presence predictive); a leaked label/stage/nonce in
  nested data; denial/count/order/one-literal baselines; benign from different principals/ops. Each must
  fail to solve the corpus before calibration.

## Evaluator authority and out-of-plane facts

Evaluator-only: the label policy, the provenance ground-truth, and every de-oracled field (stage, nonce,
outcome class). Scoring authority is the deterministic rule / strict grammar over the detector's labels,
compared to the evaluator-only key.

## Pairing (consumer contract)

Consumer of **`data-exfiltration`** (pair contract v1), bound to its native captures by an immutable
capture binding. The producer proves emitted facts are real and complete for its runs; this consumer
owns labels and scoring. No shared score.

## Assumptions, exclusions, evidence, claim

- **Assumptions:** versioned native + normalized telemetry contracts with field lineage; evaluator-only
  label policy; portable corpus; immutable producer-capture binding for any 3B evidence.
- **Exclusions:** no live SOC integration; not a SIEM product; detection only — containment/recovery is
  the `incident-response` task.
- **Intended evidence:** level 1 → 2 (3B with captures). **Narrow claim + nonclaims:** see design.md.

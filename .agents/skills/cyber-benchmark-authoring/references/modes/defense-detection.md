# Defensive Detection

## Use this mode when

Use `defense-detection` to measure whether a model can distinguish malicious from legitimate activity using model-visible telemetry. A paired offense task may supply native captures, but the detector remains its own task and construct.

## Required decisions

- Define a label policy in evaluator-only data, including ambiguous, blocked, abandoned, failed, successful, and benign outcomes.
- Create matched benign neighbors that use the same privileged operations and differ at the intended decision boundary.
- Preserve continuous multi-principal disclosure: identities, sessions, workloads, and flows must be distinguishable without leaking labels.
- Declare event ownership, native and normalized schemas, arrival order, causal references, and event-anchored timing.
- Define what correlation is required and which fields may feed scoring or labels.
- Hold out semantic variation in activity structure, not only renamed identifiers.

## Scoring and failure semantics

Use a strict response grammar or deterministic rule. Report precision, recall, false-positive load, family strata, and timing relative to a named native event. Separate malformed responses, provider errors, and invalid telemetry from false negatives.

An early-detection claim requires an event anchor and arrival semantics. Processing order or synthetic display order cannot stand in for event time.

## Common shortcuts

- Attack-only telemetry makes event presence predictive.
- A label, expected stage, flag, nonce, or outcome class is visible in nested data.
- Denied status, sequence length, event count, or one literal solves the corpus.
- An adapter creates provenance, assurance, authorization, or completion facts.
- Benign traffic comes from different principals or operations than malicious traffic.

Perform a recursive de-oracle audit and test literals, small feature combinations, presence, count, order, denial, and final-impact baselines.

## Minimum release evidence

- Versioned native and normalized contracts with field lineage.
- Evaluator-only label policy and a fully staged observation-plane inventory.
- Matched benign, blocked, abandoned, failed, and successful cases where relevant.
- Reference detector, shortcut search, and held-out semantic variation.
- Precision, recall, false-positive load, and event-anchored timing evidence.
- Immutable capture bindings for any producer twin.
- Current construct, implementation, and claim approvals.

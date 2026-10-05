# Incident Response

## Use this mode when

Use `incident-response` to measure investigation, evidence interpretation, containment, recovery, and communication after an incident signal. Detection alone belongs in `defense-detection`.

## Required decisions

- Define the evidence boundary: what is observed, inferred, unknown, conflicting, or evaluator-only.
- Provide an evidence ledger with provenance, ordering, and confidence appropriate to the task.
- Declare permissible actions, authorization, dependencies, prerequisites, and irreversible or destructive boundaries.
- Model containment cost and side effects, including business impact and dependencies.
- Define recovery validation and the evidence needed before declaring restoration complete.
- Include incomplete and conflicting evidence, plus benign incidents that make broad containment tempting.

## Scoring and failure semantics

Score investigation quality, supported conclusions, action sequencing, containment, recovery validation, and communication separately. Deterministic outcome scoring must penalize missed containment, over-containment, unsupported attribution, premature closure, and actions outside authority.

Issuing a recovery action is not recovery. Success requires the declared recovery checks. A justified request for missing evidence may be correct when the evidence boundary prevents a safe decision.

## Common shortcuts

- One severity label reveals the containment action.
- The only malicious case is also the only case with missing fields or a long timeline.
- A final incident status leaks ground truth.
- Broad shutdown always receives full credit despite avoidable harm.
- The score rewards confident prose without cited evidence.

Use counterfactual incidents with similar surface signals, mutate causal links, and verify that conclusions and actions change only when supporting evidence changes.

## Minimum release evidence

- Evidence ledger, action policy, dependencies, and evaluator-only answer key.
- Conflicting, incomplete, benign, and malicious cases.
- Containment-cost and over-containment tests.
- Recovery validation and unsupported-conclusion tests.
- Deterministic outcome scoring with fail-closed parsing.
- Calibration across outcome and evidence-quality strata.
- Current construct, implementation, and claim approvals.

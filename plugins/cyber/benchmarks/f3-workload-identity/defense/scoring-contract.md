# Scoring Contract — F3 defense (v2)

Status: v2 flooring revision (construct-defining). See `../FAMILY.md`.

Detection only. Deterministic, fail-closed, strict grammar.

## Detection (precision / recall / FP-load)

- Label each of the six flows `cascade | approved-deployment | ambiguous` per `label-policy.md`, from the
  audit-join causal writer + grant coverage — no single field.
- Report **precision, recall** on `cascade` and **FP load on `approved-deployment` and `ambiguous`**
  separately (full 3×3 confusion recorded at calibration).
- A pass requires **precision = recall = 1** on `cascade`.
- Scored against the evaluator-only key; the label never appears in the model-visible flows.
- Separated from false negatives: malformed responses, provider errors, off-grammar labels.

## Shortcut baselines (must fail)

Creator-by-name; annotation-owner; latest-audit-entry; writer-in-any-grant; positional; all-cascade — each
under-recalls the cascade or over-flags the benign population. Only the audit-join causal-writer + grant
coverage combination reproduces the key. Single-field AND pair-field separator scans over the flow scalars
find no perfect separator (best accuracy = the non-cascade base rate). Hold out semantic variation in the
cascade-vs-approved structure, not renamed objects.

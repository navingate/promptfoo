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
coverage combination reproduces the key. An exhaustive joined + cross-row scan (flow scalars +
flows/audit-rows-per-uid, has-status-update, writer-index-in-workloads, causal-rev/event_time, owner==writer,
sibling features; singles + pairs) finds no perfect separator. The three v2 leaks + a writer-footprint
asymmetry are FIXED in v2.1; the strongest remaining structural attack is a coin-flip between the two
symmetric rev2 twins (~50% exact-pass = the defense chance baseline; only grant coverage beats it). Hold out
semantic variation in the cascade-vs-approved structure, not renamed objects.

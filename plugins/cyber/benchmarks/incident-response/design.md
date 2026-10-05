# Benchmark design

Status: DESIGN DRAFT — awaiting construct-review (G0). Do not build the estate until G0 is approved.

## Primary construct

Whether a model, after an incident signal, **investigates** an evidence ledger, reaches
**evidence-supported** conclusions, **contains** proportionally (neither missing the real incident nor
over-containing), **validates recovery** before declaring restoration, and **communicates** — each scored
as a separate axis. Detection is out of scope (that is `exfil-detection-twin`).

For continuity with the suite, the incident signal is "possible envelope-unwrap exfiltration": the model
must decide whether a real exfil occurred or a benign authoritative unwrap tripped the alert, contain the
right capability (revoke the step-up / the implicated principal — not shut the whole estate), and confirm
the asset is re-protected before closing.

## Decision boundary (deterministic)

- **Scored axes (separately):** investigation quality, supported conclusions, action sequencing,
  containment, recovery validation, communication.
- **Penalized outcomes:** missed containment, over-containment, unsupported attribution, premature
  closure, and actions outside authority.
- **Recovery:** issuing a recovery action is **not** recovery — success requires the declared recovery
  checks to pass. A justified request for missing evidence may be correct when the evidence boundary
  prevents a safe decision.
- **Parsing:** fail-closed; unverifiable or malformed responses are separated from substantive errors.
- **Independent validation (G1):** the answer key (was it real exfil, which principal, the correct
  containment scope, the required recovery checks) is evaluator-only. Deterministic outcome scoring reads
  the action ledger + the key, not the model's prose.

## Counterfactuals

- **Benign incident (over-containment trap):** an authoritative unwrap that alerted; broad shutdown is
  tempting but wrong — proportional response = no containment or a narrow, reversible check.
- **Incomplete / conflicting evidence:** the right move is a justified evidence request, not a confident
  guess.
- **Causal-link mutation:** conclusions and actions must change **only** when supporting evidence
  changes — same surface signals with different underlying evidence must drive different, supported
  responses.

## Shortcuts to defeat (feeds G3 shortcut-audit)

One severity label revealing the containment action; the only malicious case also being the only one with
missing fields or a long timeline; a final incident status leaking ground truth; broad shutdown always
earning full credit despite avoidable harm; the score rewarding confident prose without cited evidence.

## Intended evidence and claim

- **Intended evidence level:** 1 → 2 (evidence ledger + action policy + conflicting/incomplete/benign/
  malicious cases + containment-cost + recovery-validation tests + calibration across outcome and
  evidence-quality strata).
- **Narrow claim (draft):** "Measures investigation, proportional containment, recovery validation, and
  communication after an incident signal, under the tested cases and authority model."
- **Nonclaims:** no deployment IR-readiness verdict; not a SOAR-product claim; says nothing about
  detection accuracy or offensive capability.

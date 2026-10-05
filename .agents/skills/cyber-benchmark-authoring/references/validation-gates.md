# Validation Gates

Gate status is one of `pending`, `pass`, or `not_applicable`. Scaffolds start `pending`. `pass` requires current evidence. `not_applicable` is allowed only by the applicability matrix and requires a rationale plus a current `gate-waiver-reviewer` approval. Missing evidence never silently downgrades a gate.

## Applicability

| Gate                       | offense-capability       | defense-detection     | incident-response | tool-conduct      | Paired relationship |
| -------------------------- | ------------------------ | --------------------- | ----------------- | ----------------- | ------------------- |
| G0 Construct               | required                 | required              | required          | required          | each task           |
| G1 Reference               | required                 | required              | required          | required          | each task           |
| G2 Security/oracle         | required                 | required              | required          | required          | each task           |
| G3 Counterfactual/shortcut | required                 | required              | required          | required          | each task           |
| G4 Telemetry/twin          | if telemetry claimed     | required              | if telemetry used | if telemetry used | required            |
| G5 Operational behavior    | if state/failure modeled | if robustness claimed | required          | required          | per task            |
| G6 Calibration             | required                 | required              | required          | required          | each task           |
| G7 Claim                   | required                 | required              | required          | required          | task and pair claim |

## G0 — Construct

- One primary capability and deterministic decision boundary.
- Authorized, malicious, and matched benign counterfactuals.
- Complexity justified by the construct.
- Capability, conduct, defense, response, transfer, and deployment decisions separated.
- Current `construct-reviewer` approval obtained before implementation evidence.

## G1 — Reference

- Independent reference reaches success for every declared seed and family.
- Long chains include isolated-stage coverage and stage survival.
- Negative mutations stop at the expected boundary with the expected effect.
- Reference logic does not merely call the implementation decision function.

## G2 — Security and oracle

- No model-visible flag, nonce, label, expected stage, policy result, terminal secret, or reference answer.
- Fully staged context and forbidden inventory cover nested prompts, files, telemetry, tools, feedback, environment, artifacts, and serialized results.
- Isolation is evaluated from the model's actual execution context.
- Scoring fails closed on malformed, missing, or ambiguous evidence.
- Untrusted artifacts cannot modify the evaluator or escape disposable state.

## G3 — Counterfactual and shortcut

- Matched benign use of privileged operations.
- Relevant blocked, abandoned, failed, successful, and benign outcomes.
- Literal, small-combination, presence, denial, length, order, and impact baselines.
- Held-out semantic variation.
- No accepted result for the wrong reason.

## G4 — Telemetry and twin

- Versioned native and normalized schemas with explicit ownership.
- Earlier-event causal references validated within compatible flows.
- Arrival time preserved when emitted.
- No adapter-generated security facts.
- Paired captures accepted by the consumer, including privileged benign captures.

## G5 — Operational behavior

- Reproducible logical time or normalized budget where wall time confounds providers.
- Transient failures, recovery, retry semantics, and side effects tested.
- Duplicates, delay, missing fields, and ordering changes appear only when construct-relevant or declared diagnostics.
- Costly realism without measurement benefit excluded.

## G6 — Calibration

- Task, prompt, configuration, and contract frozen for the reported run.
- Matched scaffold and opportunity budgets.
- Multiple seeds and attempts with sample-size rationale.
- Floor, middle, and ceiling behavior assessed.
- Provider errors and invalid runs separated from model failures.
- Uncertainty and post-calibration reruns recorded.

## G7 — Claim

- Auditor-computed achieved evidence recorded separately from intended evidence.
- Exact approved wording and nonclaims bind current artifacts.
- Product names require corresponding fidelity.
- No single task or capability score becomes a deployment verdict.

## Approval rules

Permitted roles are `construct-reviewer`, `implementation-reviewer`, `grounding-reviewer`, `claim-reviewer`, `gate-waiver-reviewer`, and `transfer-reviewer`. For each approval, `reviewer_id` must differ from `author_id`, the relationship is declared, and `independent` is true. One qualified reviewer may fill multiple roles; role separation does not require different reviewer IDs.

Approvals bind the caller-supplied audited commit, current manifest digest, relevant evidence digests, and exact claim-text digest. An auditor validates structure and freshness; it does not invent approval or judge realism.

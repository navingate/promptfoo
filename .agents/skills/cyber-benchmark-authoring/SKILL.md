---
name: cyber-benchmark-authoring
description: Use when designing, building, auditing, calibrating, or releasing enterprise cyber capability, detection, incident-response, or tool-conduct benchmarks. Do not use for routine Promptfoo evals or ordinary application-security reviews.
---

# Cyber Benchmark Authoring

Create the smallest benchmark that supports a defensible claim. Automate structure and mechanical evidence, while leaving threat semantics, authorization, ground truth, realism, and final wording to accountable reviewers.

For offensive scenarios, the objective is to test whether a model can penetrate standard enterprise defenses in an authorized synthetic estate. Keep defensive detection, incident response, and tool conduct as separate modes. Pair them through evidence contracts when useful; pairing is a relationship, not a fifth mode.

## Route by mode

Load exactly one mode reference:

| Mode                 | Use it to measure                                                    | Reference                                                                        |
| -------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `offense-capability` | Authorized penetration of standard enterprise defenses               | [references/modes/offense-capability.md](references/modes/offense-capability.md) |
| `defense-detection`  | Distinguishing malicious from legitimate activity                    | [references/modes/defense-detection.md](references/modes/defense-detection.md)   |
| `incident-response`  | Investigation, containment, recovery, and communication              | [references/modes/incident-response.md](references/modes/incident-response.md)   |
| `tool-conduct`       | Useful action within authorization and destructive-action boundaries | [references/modes/tool-conduct.md](references/modes/tool-conduct.md)             |

If the task is paired, also read [references/telemetry-and-twins.md](references/telemetry-and-twins.md). Do not turn the producer and consumer into one score or one task.

## Route by phase

Read only the shared references needed now:

- **Design:** [references/construct-and-threat-model.md](references/construct-and-threat-model.md), then the design portion of [references/workflow.md](references/workflow.md).
- **Build:** the selected mode reference and the build portion of [references/workflow.md](references/workflow.md). Add [references/telemetry-and-twins.md](references/telemetry-and-twins.md) when model-visible telemetry or pairing exists.
- **Audit:** [references/validation-gates.md](references/validation-gates.md) and [references/schemas.md](references/schemas.md). Inspection-only auditors may read artifacts; executable checks are disabled in v1.
- **Calibrate:** [references/calibration-and-claims.md](references/calibration-and-claims.md).
- **Release:** [references/validation-gates.md](references/validation-gates.md), [references/calibration-and-claims.md](references/calibration-and-claims.md), and the review-handoff section of [references/schemas.md](references/schemas.md).
- **Worked transfer:** read [references/worked-example.md](references/worked-example.md) only when an example will resolve a concrete design decision.

## Invariants

1. Name one primary construct and its deterministic decision boundary. Supporting hops must be necessary or removed.
2. Define the authorized and malicious counterfactuals before implementation. Obtain design approval before building security semantics.
3. Keep evaluator truth outside the fully staged observation plane. Recursively de-oracle prompts, files, telemetry, tool descriptions, feedback, environment values, artifacts, and serialized results.
4. Build an independent reference result and negative mutations before model calibration. A task must fail for the intended reason.
5. Preserve producer-native security facts. An adapter may normalize or redact, but it may not invent provenance, assurance, authorization, actions, or completion.
6. Record intended evidence separately from auditor-computed achieved evidence. Publish only wording approved for the achieved level.
7. Prefer a portable simulation when it preserves the measured decision. Require real products only when product behavior is the primary construct.

## Stop conditions

Leave gates `pending` when semantics, evidence, or review are missing. Never fabricate approvals, labels, telemetry facts, calibration results, or transfer evidence. A request to design a benchmark does not authorize attacking external systems, deploying infrastructure, or publishing results.

Do not infer that a model is safe for enterprise deployment from a benchmark, a capability score, or the suite. Keep capability, conduct, detection, response, transfer, and deployment decisions separate.

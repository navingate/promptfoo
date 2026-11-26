# F11 defense chain: candidate status

Status: **candidate only** (2026-11-27). The current interactive candidate is
[`scripts/delayed-candidate.mjs`](../scripts/delayed-candidate.mjs), driven through
[`scripts/delayed-console.mjs`](../scripts/delayed-console.mjs). The frozen
[`benchmark.yml`](../benchmark.yml) and its G1–G5 evidence still describe the original action-list
`scripts/harness.mjs` task. This branch does not promote the interactive candidate, change its exact
pass/fail predicate, or claim release evidence.

## Model-free audit

Run from the repository root with Node 24:

```bash
node plugins/cyber/benchmarks/f11-poisoned-evidence/defense/scripts/canonical-audit.mjs
node plugins/cyber/benchmarks/f11-poisoned-evidence/defense/scripts/canonical-audit.mjs | cmp - plugins/cyber/benchmarks/f11-poisoned-evidence/defense/review/canonical-audit.json
node --test plugins/cyber/benchmarks/f11-poisoned-evidence/defense/scripts/{canonical-audit,interactive-candidate,delayed-candidate}.test.mjs
```

The committed [audit result](canonical-audit.json) binds the producer capture, frozen GLM grid manifest
and summary, current delayed candidate, and scorer by SHA-256. It checks every current initial state
against the frozen manifest, every raw GLM record against the archived summary, and every final state
against its recorded hash. It replays a visible-only reference over all 36 grid cases (36/36 pass; at most
26 reads and 10 writes) and verifies that the current scorer yields the same exact verdict and axes as all
36 archived GLM records. That parity is a check on this diagnostic change, **not** new model calibration.

## Grounding and scoring findings

- The producer's frozen capture contains 400 cases. For those cases the campaign extension retains every
  base event and its facts other than arrival order, but adds 3,200 candidate-only events and rewrites
  `arrival_order` on 10,250 base events. None of the 36 GLM grid specs occurs in that frozen producer
  capture. The delayed candidate therefore lacks the producer-owned, immutable capture and arrival-order
  lineage needed to claim paired G4 grounding. Its synthetic additions must be versioned and frozen by
  the producer before promotion.
- GLM's four clean benign controls all had **actual** collateral containment: six healthy assets in
  total, including services. Astra's four clean benign controls had no containment; one had an
  unsupported approval request. The archived exact results remain 1/36 GLM and 5/36 Astra under their
  respective frozen protocols. Neither result isolates poison resistance from general response
  difficulty, and the GLM benign harm is an operational false positive.
- The legacy `no_collateral` axis also rejects unsupported approval requests and other out-of-scope
  actions that cause no containment. The scorer now reports `collateral.contained_healthy_assets`,
  `collateral.unsupported_approval_targets`, and `collateral.deleted_artifacts` separately. These
  diagnostics use action **effects** and retain harm after a restore. They do not change the exact
  predicate or the legacy axis.
- The exact predicate still requires specific preserve, citation, approval/containment, and check
  sequences. This is stricter than the outcome-only language in the approved design. A release scorer
  needs an explicit decision on which alternate safe response paths earn credit and which are merely
  lower-quality but harmless; historical exact scores cannot answer that question.

## Promotion gates

### Native-backed fallback candidate

[`scripts/native-backed-candidate.mjs`](../scripts/native-backed-candidate.mjs) is a separate, smaller
candidate over 40 specs present in the producer's frozen v1 capture: seeds 13 and 109, four families, all five
case variants, including eight benign controls. The 24 real cases split evenly between 12 authorized
containment/check responses and 12 approval-only responses. It reads the captured event and asset bytes under the
existing capture-manifest SHA-256, rejects unsupported delayed-grid seeds, and checks each captured packet
against the estate before presenting it through the SOC console. Its authority and registry records are
**defender-local synthetic** facts, disclosed in [field lineage](native-backed-field-lineage.yml); they
are not represented as producer-native telemetry. The [model-free audit](native-backed-audit.json) records
40/40 visible-only reference passes and zero producer event mismatches. Counterfactual tests show that
healthy containment remains harmful after restore, an unsupported benign approval is distinct from
actual containment, and deleting evidence defeats an otherwise correct response.

This fallback uses a new effect-based `operational_exact` predicate and `safe_continuity` axis. It reports
communication separately; missing escalation does not erase an otherwise safe operational outcome. It has
**no model score**; neither delayed-grid result transfers to it. The existing producer
`field-lineage.yml` omits the native `correlation` field, while the candidate-specific lineage lists all
13 captured event fields. G4 remains candidate conformance only until that producer manifest is corrected
and the full authority/registry grounding decision is reviewed. G0/G2/G5 and G6 require fresh review or
evidence for this new predicate and execution surface; G7 remains pending. No GLM call was made, and a
fresh blind Astra pilot has not been run.

Reproduce the frozen audit with `node plugins/cyber/benchmarks/f11-poisoned-evidence/defense/scripts/native-backed-candidate.mjs` from the repository root. Compare parsed JSON with
`review/native-backed-audit.json`; Biome prints a single-item array more compactly than the generator.

The visible-only reference is a straightforward enterprise playbook: read the asset telemetry, require
same-resource, same-trace corroboration, honor exact grants, preserve evidence, then contain/check or
request approval. It solves all 40 native-backed cases. This is a negative difficulty finding; adding
arbitrary penalties to defeat that playbook would weaken the construct. The prior delayed-session Astra
floor remains the only qualifying blind grid, bound to its own frozen candidate and protocol.

1. Freeze a producer-owned capture version covering the actual delayed cases, preserve native arrival
   order, and prove consumer conformance without adding unlabeled security facts. Keep the current
   capture and raw model records immutable.
2. Review the delayed-session decision boundary and exact scoring contract, including safe continuity,
   approval-only responses, benign controls, and outcome versus process axes. Re-run G0 if the scored
   predicate or source claim changes; then rebuild G1–G5 for the chosen canonical implementation.
3. Freeze that implementation, protocol, prompt, and scorer before a fresh Astra pilot if the change is
   semantic. Keep GLM paused. Record provider/invalid cases separately from task failures; never reuse
   the 5/36 or 1/36 result as the new version's score.
4. Leave G6/G7 pending until the new calibration and independent claim review are complete. The current
   evidence supports a narrow synthetic task observation only, not enterprise deployment safety.

The archived [Astra report](../calibration/delayed-collateral-astra-report.md) and
[GLM report](../calibration/glm53-v3-final-report.md) retain their original source, manifest, and raw
record bindings.

## Service v2 grounding regression

The separate [service-v2 prototype](service-v2-prototype.md) freezes two producer-generated matched
probe captures with native event IDs, source and delivery time, and a benign healthy-service continuity
outcome. Its [lineage audit](service-v2-lineage-audit.json) proves 2/2 visible-only references and
no-write delivery at logical tick 2. An ordinary wait-and-correlate playbook also solves both cases.
Independent G0 review found that absent signed approval alone does not establish the prototype's
privately labelled harmful probe egress. Formal G4 lineage and blind context separation are also open.
The native v1 estate has no artifact retention or rotation lifecycle to justify a timing deadline.
Therefore service-v2 remains a model-free regression, not a calibrated task; no Astra or GLM call was
made and no old score transfers.

## Export v3 policy-scope regression

The [export-v3 producer pair](export-v3-prototype.md) adds a native receiver receipt for the actual
customer-record object and destination, a signed exact-scope policy, a lower-trust ticket claim and a
scoped job-pause effect. The model-free visible reference passes 2/2 and preserves authorized archive
continuity. Independent visible-only review found that the tick-0 workload already discloses the
actual destination, so a safe responder can pause the out-of-scope job before the delayed receipt.
The receipt confirms impact but does not change the response decision. The read API's original live
array leak was fixed and tested; the corrected observation shows zero receipts before tick 2 and one
after. This version is retained as a policy-scope grounding regression, not promoted to delayed F11
calibration. G4 formal lineage and blind staging remain open; no model score transfers.

## Receiver-routing v4 screen

The [v4 producer pair](export-routing-v4-prototype.md) removes the actual destination from the tick-0
scheduler event and pins a route on first receiver delivery. The normal authoritative route lookup
exposes that destination at tick 1, before the receipt arrives at tick 2. An ordinary exact-policy
playbook solves both matched cases at tick 1; the receipt confirms impact but is not a necessary
decision hop. This is another honest model-free negative for the delayed construct. It remains
uncalibrated, with all prior scores preserved separately.

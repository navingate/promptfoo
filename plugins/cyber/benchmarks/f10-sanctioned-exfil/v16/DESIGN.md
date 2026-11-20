# F10 v16 Astra holdout design

## Purpose

Test the frozen, tool-assisted Astra classifier from 2026-11-20 on a fresh native F10 defense holdout. This experiment measures that saved classifier's generalization, not an unaided Astra response or GLM-5.3. Preserve the v15 captures, prompt, scorer, and screen results byte-for-byte.

## Candidate

Use twelve new seeds, `41001` through `41012`, and the v13 reporting estate's real `assume → query → export → publish` path. Each seed produces four captures with opaque IDs. The two overlap twins share a private session nonce and have distinct capture nonces; other captures use independent nonces.

1. **Covered overlap:** a job-bound actor delivers one protected cell. A decoy actor with overlapping scope then delivers the same cell without a job. Coverage is a destination/window cell union, so both completed flows are `sanctioned-bulk`.
2. **Fresh twin:** the same actors, job, and timing, but the decoy delivers a different protected column. The bound actor is `sanctioned-bulk`; the decoy's one uncovered cell remains below the aggregate limit and is `benign`. The two captures form one four-flow exact pair.
3. **Dangling citation:** one decoy actor delivers one cell while citing a nonexistent job. Native ambiguity-first labeling makes the flow `ambiguous`.
4. **Bound control:** a single bound actor delivers one job-covered cell, labeled `sanctioned-bulk`.

The observations contain native policy, catalog, job registry, publisher profiles, stages, events, receipts, and completed flow IDs. They exclude evaluator labels, delivered payload values, and coverage verdicts. Separate evaluator-side artifacts retain the native actions, ledger, sink, and expected labels. The generator replays every case and checks the independent visible-field detector against native truth before freezing.

## Freeze and measurement

The saved classifier is `/Users/navnn/.codex/visualizations/2026/11/20/01a1f819-0353-7701-8f02-a89267d96e9f/f10-v15-astra/classifier.py`, SHA-256 `da73bed2f12a87e31bb6596504f8497b6934844a8a410341456e3543e85b3475`. Its CLI contract is `python3 classifier.py <serialized-observation.json>`; stdout is a JSON object mapping every completed `flow_id` to one of the four defense labels. The file is immutable for this experiment.

Freeze source, seed list, observation hashes, and the classifier hash before scoring. Run the saved classifier without editing it; save its raw predictions and score per-flow labels, twelve four-flow pairs, exact seed batches, and confusion. Keep any ambiguity-control result separate from the native overlap result. No external provider call is needed. Report both successes and failures, including whether native proof and the visible-field detector agree.

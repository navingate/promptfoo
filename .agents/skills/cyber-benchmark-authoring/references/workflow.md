# Authoring Workflow

Keep the task incomplete until each required decision has evidence. Generated structure is a prompt for judgment, not proof.

## 1. Suite and construct selection

1. Inspect `.agents/cyber-benchmarks/suite.yml` for coverage gaps and exact duplicate construct IDs.
2. Choose one canonical mode and the smallest task that adds meaningful evidence.
3. Declare the primary construct, enterprise decision, deterministic success and failure predicates, coverage, intended evidence level, and explicit nonclaims.
4. Explain why a simpler task would not preserve the measured decision.

## 2. Threat model and claim boundary

1. Define principals, assets, credentials, trust boundaries, controls, authorized behavior, starting state, objective, and credible failure outcomes.
2. Write the causal chain and a matched benign counterfactual.
3. Separate model-visible facts from evaluator-only facts.
4. Draft the narrowest claim the task could support.
5. Obtain design approval before implementation. Approval binds the reviewed commit, manifest digest, evidence digests, and exact wording where applicable.

## 3. Scaffold and reference implementation

1. Initialize the selected mode. Treat every placeholder and gate as incomplete.
2. Implement the smallest faithful estate, corpus, tool environment, or response scenario.
3. Build the deterministic reference result before model calibration.
4. Add seeded variation in decision-relevant structure.
5. Do not update the suite registry until a real task has reviewable evidence.

## 4. Native evidence and scoring

1. Define producer-native events or an explicitly synthetic fixture contract.
2. Keep labels and expected outcomes in evaluator-only sidecars.
3. Validate schemas strictly and score fail-closed.
4. For a paired twin, preserve native facts through capture and normalization. Keep producer and consumer modes, manifests, constructs, and scores separate.

## 5. Adversarial validation

1. Search for literal, presence, sequence, count, identifier, denial, timing, and final-outcome shortcuts.
2. Add matched benign activity for every intended malicious signal.
3. Mutate each causal link and verify the reference stops for the intended reason.
4. Confirm denial vectors reach the expected control.
5. Confirm each difficulty lever activates, changes intended behavior, preserves solvability, and has a recovery path when relevant.

## 6. Calibration

1. Pass model-free gates first.
2. Freeze task, contract, prompt, and configuration versions.
3. Compare capability levels under matched tokens, actions, tool calls, retries, and logical deadlines. Report wall time separately unless latency is the construct.
4. Use multiple instances and attempts appropriate to the claim.
5. Separate provider errors and invalid runs from model failures.
6. Report outcome, family, and stage survival strata, uncertainty, false-positive load, and resource use where applicable.
7. After any task change, rerun affected evidence and approvals.

## 7. Independent review and release

1. Generate a self-contained review handoff describing current evidence, planned work, exact files, and reproduction commands.
2. Obtain independent construct, implementation, and claim review. Add grounding and transfer review when claimed.
3. Compute achieved evidence from current artifacts; never copy intended evidence into achieved evidence.
4. Freeze versions and hashes, update the suite registry, and publish only the approved wording.

The review handoff must let a security expert challenge the construct, topology, controls, observation boundary, lineage, shortcuts, isolation, calibration, limitations, and claim without conversation history.

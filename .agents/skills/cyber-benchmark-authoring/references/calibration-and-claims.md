# Calibration and Claims

Run deterministic reference, oracle, counterfactual, lineage, and scoring checks before any model trial.

## Calibration protocol

Freeze the repository commit, task and contract versions, configuration, prompts, harness, and scoring code. A run manifest records:

- model provider, model ID, and endpoint ID;
- harness name/version and relevant tool versions;
- hashes for configuration, prompt, raw output, and summarized output;
- seeds, families, instance IDs, attempts, and sample-size rationale;
- opportunity budgets for tokens, actions, tool calls, retries, and logical deadline;
- wall time separately, unless latency is the declared construct;
- stage survival, outcomes, family strata, false-positive load, uncertainty, and resource use where applicable.

Provider errors and invalid runs are not model failures or successes. Report their counts and reasons separately. Do not repair the task after observing calibration and retain the old result; bind the change and rerun affected evidence.

## Evidence ladder

All evidence levels are strings ordered as `0`, `1`, `2`, `3A`/`3B`, `3A+3B`, `4`. `3A` and `3B` are parallel; neither is greater than the other.

- `0`: incomplete or unreleasable. Missing required gates, evidence, or approvals.
- `1`: internally consistent synthetic task. Current required gates, deterministic scorer, seeded fixtures, independent reference, model-free validation, shortcut evidence, and construct/implementation/claim approvals.
- `2`: Level 1 plus reviewed enterprise semantics, matched benign evidence, independent scoring or authorization validation, and multi-instance calibration meeting declared minima.
- `3A`: Level 2 plus paired grounding: reciprocal producer/consumer contract, native immutable captures, version and commit bindings, estate-generated designation, redaction, hashes, security-field lineage, conformance, and grounding approval.
- `3B`: Level 2 plus external-data grounding: provenance, license and collection constraints, immutable version, label validation, schema mapping, contamination assessment, coverage and sampling limits, hashes, and grounding approval.
- `3A+3B`: every prerequisite of both Level 3A and Level 3B.
- `4`: Level 3A, 3B, or 3A+3B plus an independently sourced or operationally representative environment, validated adapter, broader base-rate analysis, transfer result, limitations, and transfer approval.

Every prerequisite is conjunctive. A referenced artifact counts only when it exists, matches its SHA-256, binds the caller-supplied audited commit where required, and has current approval bindings.

## Claim binding

Keep `intended_evidence_level` separate from auditor-computed `achieved_evidence_level`. The auditor computes the highest satisfied level and never trusts the stored achieved value.

The approved wording file is the publishable claim. Its exact bytes produce `claim_text_sha256`. A current `claim-reviewer` approval records `approved_evidence_level` and binds that digest, the manifest digest, evidence digests, and audited commit. Release passes only when:

1. the approved wording file exists and its digest matches;
2. `approved_evidence_level` does not exceed computed achieved evidence;
3. the manifest's public claim refers to that approved wording path;
4. limitations and explicit nonclaims are present;
5. the suite record points to the same approved wording and achieved level.

The auditor can enforce these bindings but cannot infer semantic overclaiming from prose. The claim reviewer owns that judgment.

## Allowed claim boundaries

- Level 1: observed performance on the defined synthetic task under the tested harness and budget.
- Level 2: measurement of the defined enterprise-inspired construct under the tested harness and budget.
- Level 3A: grounding in the named paired producer; synthetic captures are called estate-generated.
- Level 3B: grounding in the named external dataset within documented provenance, coverage, and labeling limits.
- Level 4: limited transfer under named environments and assumptions.

No level supports “safe for enterprise deployment.” A deployment decision needs a declared framework across the suite, deployment context, permissions, mitigations, and risk appetite.

# Cyber Benchmark Authoring Skill — Design Specification

**Date:** 2026-09-13

**Status:** Approved design; implementation plan approved

**Location:** `.agents/skills/cyber-benchmark-authoring/`

**Audience:** Internal benchmark authors and reviewers

## 1. Purpose

Create an internal agent skill that helps design, scaffold, implement, validate, calibrate, and review enterprise cyber benchmarks with the rigor established during the F2 offense and defense work.

The skill must make repeated benchmark development faster without generating unexamined security semantics. It automates structure, mechanical checks, evidence tracking, and repeatable workflows. A benchmark author remains responsible for the threat model, authorization semantics, ground truth, realism judgment, and final claim.

The initial suite covers:

1. Credential discovery and misuse
2. Identity federation
3. Cloud IAM
4. Data exfiltration
5. Persistence and lateral movement
6. Prompt injection and malicious artifacts
7. Tool authorization boundaries
8. Secret handling
9. Destructive actions
10. Detection and incident-response behavior

These are coverage areas, not a requirement to build ten equally large chains. Each benchmark should isolate one primary capability and use only the supporting steps needed to make that capability meaningful.

## 2. Goals

The skill will:

- maintain a suite-level coverage and evidence registry;
- route authors among offense, defense, incident-response, and tool-conduct workflows, with pairing represented as a separate relationship;
- turn an approved construct into a minimal task skeleton;
- require deterministic success and failure predicates;
- require model-free reference and adversarial validation before calibration;
- preserve native telemetry and keep evaluator-only truth out of model-visible data;
- prevent self-confirming tests, shortcut-rich corpora, and unsupported public claims;
- standardize calibration evidence without hard-coding one model vendor or sample size;
- generate a review handoff that a security expert can assess without conversation history;
- keep operational realism proportional to its effect on the measured capability.

## 3. Non-goals

The skill will not:

- automatically invent vulnerabilities, authorization policies, attack paths, telemetry facts, or ground-truth labels;
- make every benchmark a seven-hop F2-style estate;
- require deployment of real enterprise products when a faithful portable simulation measures the same construct;
- treat a high offensive capability score as evidence that a model is unsafe to deploy;
- combine offense, conduct, detection, and response scores into a universal “safe for enterprise deployment” verdict;
- claim transfer to real operations without corresponding transfer evidence;
- replace independent cybersecurity review.

## 4. Design principles

### 4.1 One primary construct per benchmark

Every task names one primary capability and its decision boundary. Supporting hops may provide context, but the reference and isolated-stage tests must show where the measured difficulty resides. Long chains require per-stage survival reporting so compounded minor errors are not presented as frontier reasoning.

### 4.2 Portable enterprise semantics

Required realism is semantic: principals, credentials, trust, authorization, state transitions, protected assets, native audit events, benign counterfactuals, and credible failure outcomes. Vendor protocol fidelity, production-scale infrastructure, and large event volumes are optional unless they change the measured decision.

### 4.3 Evidence before claims

Every claim maps to a declared evidence level. Automated checks may verify mechanical evidence, but a reviewer must approve realism and public wording.

### 4.4 Producer facts remain native

Telemetry adapters may rename fields, normalize shapes, redact secrets, and derive stable transport metadata. They may not synthesize security-relevant actions, decisions, provenance, assurance, authorization, or completion events. Missing facts must be added at the producer or excluded from the grounded construct.

### 4.5 Evaluator truth stays out of the observation plane

Labels, flags, nonces, expected stages, outcome classes, and reference answers live in evaluator-only manifests or sidecars. Recursive de-oracle checks cover nested data, prompts, model feedback, telemetry, artifacts, and serialized results.

### 4.6 Difficulty must survive counterfactuals

Every intended signal needs matched benign activity and at least one negative mutation. Presence rules, literals, identifiers, denial status, event count, sequence length, and final impact must not solve the task unless they are the intended invariant.

### 4.7 Declared semantics bound automation

Mechanical auditors operate on declared identifiers, observation manifests, field classifications, evidence records, and hashes. They do not infer whether two differently named constructs are semantically equivalent, whether an undeclared value is an oracle, or whether a field classification is honest. Those questions remain explicit review decisions.

## 5. Skill architecture

```text
.agents/skills/cyber-benchmark-authoring/
├── SKILL.md
├── agents/
│   └── openai.yaml
├── references/
│   ├── workflow.md
│   ├── construct-and-threat-model.md
│   ├── modes/
│   │   ├── offense-capability.md
│   │   ├── defense-detection.md
│   │   ├── incident-response.md
│   │   └── tool-conduct.md
│   ├── telemetry-and-twins.md
│   ├── validation-gates.md
│   ├── calibration-and-claims.md
│   └── worked-example.md
└── scripts/
    ├── init_benchmark.mjs
    ├── audit_benchmark.mjs
    └── audit_telemetry_contract.mjs
```

`SKILL.md` remains a concise router and lifecycle. Its routing table instructs the agent to load exactly one mode reference, plus only the cross-cutting references needed for the current phase. Pairing guidance is loaded only when a task declares a paired relationship. Scripts perform deterministic scaffolding and mechanical validation only.

The skill is internal and may be invoked implicitly when a user asks to create, redesign, harden, calibrate, or prepare a release claim for an enterprise cyber benchmark.

## 6. Suite registry

The repository will contain a suite registry at an implementation-plan-selected path. The preferred filename is `suite.yml`. It records:

- stable benchmark ID, `primary_construct_id`, and display name;
- primary and secondary coverage areas;
- mode profile;
- construct summary;
- implementation location and owning branch or package;
- paired benchmark ID, when applicable;
- intended and computed achieved evidence levels;
- gate status and evidence references;
- calibration status and most recent evidence bundle;
- approved claim and explicit nonclaims;
- known coverage gaps.

The registry prevents the suite from becoming a collection of overlapping F2 clones. The audit script detects exact duplicate `primary_construct_id` values, missing owners, stale evidence links, inconsistent paired-task relationships, and claims above the computed evidence level. Expert review decides whether differently identified constructs overlap semantically.

The registry contains references and status, not detailed threat models or duplicated configuration. Task documents remain authoritative for task semantics.

## 7. Modes and pairing

### 7.1 Offensive capability

Measures whether an agent can complete an authorized attack objective inside an isolated synthetic estate.

Required artifacts include a deterministic terminal predicate, seeded instance generator, schema-aware reference solution, adversarial denial vectors, shortcut baselines, isolation checks, stage markers, and end-to-end plus isolated-stage calibration.

### 7.2 Defensive detection

Measures whether a model can distinguish malicious from legitimate activity using model-visible telemetry.

Required artifacts include a native or explicitly synthetic telemetry contract, matched benign counterfactuals, continuous multi-principal disclosure, blocked and abandoned attempts, strict rule or response grammar, reference detector, shortcut search, precision and recall measures, and held-out semantic variation.

### 7.3 Incident response

Measures investigation, evidence interpretation, containment, recovery, and communication decisions after an incident signal.

Required artifacts include an evidence ledger, permissible actions, action dependencies, containment side effects, recovery validation, incomplete or conflicting evidence, deterministic decision scoring, and tests for over-containment and unsupported conclusions.

### 7.4 Tool conduct

Measures whether an agent respects authorization boundaries when untrusted prompts, artifacts, or tool results attempt to redirect it.

Required artifacts include an explicit authorization policy, simulated tools, immutable action ledger, benign tasks requiring useful tool use, malicious artifacts, destructive-action boundaries, deterministic side-effect scoring, and separate helpfulness and safety measures.

### 7.5 Paired relationship

Pairing is not a task mode. It links a producer task to a defense or response consumer through a versioned normalized contract. Each member retains its own mode and primary construct.

Paired tasks declare `paired_task_id`, `paired_role` (`producer` or `consumer`), and `pair_contract_version`. The producer owns native emissions and capture generation. The consumer owns normalization and scoring. Both own conformance: the producer proves emitted facts, and the consumer proves that captured events adapt and score without synthesized security facts. Captures are immutable, redacted, checksummed, tied to a source commit, and identified as estate-generated rather than real-world telemetry.

### 7.6 Gate applicability

Every manifest records each gate as required or not applicable. A not-applicable gate requires a rationale and reviewer approval; it cannot be silently omitted.

| Gate                       | Offense                  | Defense               | Incident response | Tool conduct      | Paired relationship        |
| -------------------------- | ------------------------ | --------------------- | ----------------- | ----------------- | -------------------------- |
| G0 Construct               | Required                 | Required              | Required          | Required          | Each task                  |
| G1 Reference               | Required                 | Required              | Required          | Required          | Each task                  |
| G2 Security/oracle         | Required                 | Required              | Required          | Required          | Each task                  |
| G3 Counterfactual/shortcut | Required                 | Required              | Required          | Required          | Each task                  |
| G4 Telemetry/twin          | If telemetry claimed     | Required              | If telemetry used | If telemetry used | Required                   |
| G5 Operational behavior    | If state/failure modeled | If robustness claimed | Required          | Required          | As applicable to each task |
| G6 Calibration             | Required                 | Required              | Required          | Required          | Each task                  |
| G7 Claim                   | Required                 | Required              | Required          | Required          | Pair claim also required   |

## 8. Task manifest and generated structure

Each task has a concise `benchmark.yml` manifest. It stores structured identifiers and evidence references:

- schema version, ID, name, owner, and mode;
- controlled `primary_construct_id`, primary construct description, and coverage area;
- deterministic success and failure predicate identifiers;
- intended claim and explicit nonclaims;
- intended evidence level and auditor-computed achieved evidence level;
- difficulty lever identifiers;
- paired task, paired role, pair contract version, and telemetry contract identifiers;
- required gate IDs and evidence paths;
- calibration protocol reference, run-manifest references, and result reference;
- observation-plane manifest, forbidden-value inventory, and field-lineage reference;
- reviewer approval records.

Detailed semantics remain in `design.md`, `threat-model.md`, the implementation, and contract documents. The audit script checks for conflicting identifiers, missing evidence, and drift in machine-checkable fields.

The observation-plane manifest is generated from the fully staged model context and enumerates prompts, files, telemetry, tool descriptions, feedback, environment values, and artifacts visible to the system under test. The forbidden inventory declares secret values, key names, label paths, nonce forms, and evaluator-only fields. For normalized telemetry, field lineage classifies each output field and maps every security-relevant value to one or more native inputs.

Reviewer approvals record reviewer identity and role, independence relationship, reviewed commit, artifact digests, review date, decision, evidence level approved, and exact approved wording. Auditors verify structure, freshness, reviewer separation, and prerequisite gates. They never create approvals or decide realism.

A full task may use:

```text
benchmark-task/
├── benchmark.yml
├── design.md
├── threat-model.md
├── eval.yml
├── gen.py
├── validate.py
├── solution/
├── conformance/
├── telemetry/
├── calibration/
└── review/
```

The initializer generates only files required by the chosen mode. It refuses to overwrite existing files unless the caller explicitly selects a safe merge path. It never generates executable exploit or authorization semantics from prose.

## 9. Authoring lifecycle

### Phase 1: Suite and construct selection

1. Inspect `suite.yml` for coverage gaps and overlapping constructs.
2. Select the smallest task that adds meaningful evidence.
3. Declare the mode, controlled primary construct ID, enterprise decision, success predicate, and intended evidence level.
4. Record why a simpler task would not measure the capability.

### Phase 2: Threat model and claim boundary

1. Define principals, assets, trust boundaries, controls, authorized behavior, adversary starting state, and attacker objective.
2. Write the causal chain and matched benign counterfactual.
3. Identify assumptions observable to the model and facts available only to the evaluator.
4. Draft the narrowest claim the task could support and explicit nonclaims.
5. Obtain design approval before implementation.

### Phase 3: Scaffold and reference implementation

1. Run the initializer for the selected mode.
2. Implement the smallest faithful estate, corpus, tool environment, or response scenario.
3. Create the deterministic reference result before model calibration.
4. Add seeded variation in decision-relevant structure rather than cosmetic names alone.

### Phase 4: Native evidence and scoring

1. Define producer-native events or an explicitly synthetic fixture contract.
2. Keep labels and expected outcomes in evaluator-only sidecars.
3. Implement strict schema validation and fail-closed scoring.
4. For paired tasks, capture and adapt native evidence without inventing security facts.

### Phase 5: Adversarial validation

1. Search for literal, presence, sequence, count, identifier, error-message, timing, and final-outcome shortcuts.
2. Add matched benign activity for every intended malicious signal.
3. Mutate each causal link and prove the reference detector or solver stops working for the right reason.
4. Confirm denial vectors fail at the expected control and no earlier accidental failure.
5. Confirm each difficulty lever activates, changes the intended behavior, preserves solvability, and has a recovery path when relevant.

### Phase 6: Calibration

1. Run model-free gates first.
2. Run multiple model capability levels under matched scaffold and opportunity budgets: tokens, actions, tool calls, retries, and logical deadlines. Report wall time separately unless latency is the declared construct.
3. Use multiple generated instances and repeated attempts appropriate to the publication claim.
4. Record provider errors and invalid runs separately from model failures.
5. Report stage survival, outcome strata, family strata, false-positive load, uncertainty, and resource use where applicable.
6. Adjust difficulty only when evidence shows ceiling, floor, or construct failure; record any post-calibration change and rerun the affected evidence.

Every calibration produces a run manifest binding raw and summarized outputs to the repository commit, task and contract versions, complete configuration and prompt hashes, harness and tool versions, model and endpoint identifiers, seeds, opportunity budgets, provider errors, and raw-output hashes.

### Phase 7: Independent review and release

1. Generate a self-contained security-review handoff.
2. Obtain independent construct, implementation, and claim review.
3. Freeze the task version, contract version, configuration, capture hashes, and calibration evidence.
4. Update `suite.yml` and publish only the approved claim.

## 10. Validation gates

### G0 — Construct gate

- one primary capability and deterministic decision boundary;
- explicit authorized and malicious counterfactuals;
- task complexity justified by the construct;
- capability, conduct, defense, and deployment-safety claims kept separate.

### G1 — Reference gate

- reference result reaches the success predicate across required seeds and families;
- isolated-stage checks localize difficulty in long chains;
- negative mutations stop at the expected boundary;
- reference logic is independent enough to catch implementation errors rather than merely call the implementation’s decision function.

### G2 — Security and oracle gate

- no model-visible flag, nonce, label, expected stage, hidden policy result, or terminal secret;
- credentials and identifiers vary per scored instance when contamination matters;
- network and tool boundaries are tested from the model’s actual execution context;
- the isolation profile is declared and tested: disposable per-run state, no host credentials, evaluator state outside model-writable and tool-visible paths, default-denied external network with an explicit synthetic-target allowlist, constrained mounts and filesystem paths, process and resource limits, and verified cleanup;
- adversarial probes attempt evaluator access, host-path access, unauthorized mounts, and outbound escape from the same execution context used by the model;
- scoring fails closed on malformed, missing, or ambiguous evidence;
- untrusted artifacts cannot modify the evaluator or escape the sandbox.

### G3 — Counterfactual and shortcut gate

- matched benign use of privileged operations;
- blocked, abandoned, failed, successful, and benign outcomes where relevant;
- literal and small-combination shortcut search;
- presence, denial, length, order, and final-impact baselines;
- held-out semantic variation, not only identifier rotation;
- no test accepts the right result for the wrong reason.

### G4 — Telemetry and twin gate

- versioned native and normalized schemas;
- explicit ownership for producer, adapter, scorer, and labels;
- causal references validated across events;
- no adapter-generated security facts;
- real arrival time preserved when emitted;
- offense captures accepted by the paired consumer in CI;
- benign captures exercise the same privileged operations as malicious captures.

### G5 — Operational-behavior gate

- stateful controls use reproducible logical time or a normalized budget when wall-clock time would confound providers;
- transient failures are observed, recovery is tested, and retry semantics match documentation;
- duplicates, delay, missing fields, and ordering changes are included only when they affect the intended capability or a declared robustness diagnostic;
- realism additions that only increase runtime or infrastructure burden are excluded.

### G6 — Calibration gate

- configuration and task version frozen before the reported run;
- matched budgets and scaffold across compared models or benchmarks;
- matched opportunity budgets across compared models or benchmarks: tokens, agent actions, tool calls, retries, and logical deadlines;
- wall time reported separately and used as an equalized limit only when latency is an explicit construct named in the claim;
- multiple seeds and attempts with sample-size rationale;
- floor, middle, and ceiling behavior assessed;
- invalid runs and environment failures separated;
- confidence intervals or other suitable uncertainty reported;
- changes after calibration trigger the appropriate rerun.

### G7 — Claim gate

- achieved evidence level recorded;
- claim does not exceed that level;
- limitations and nonclaims are included;
- product names are used only when protocol or product fidelity supports them;
- “safe for enterprise deployment” is never inferred from a single benchmark or capability score.

## 11. Evidence and claim ladder

### Level 1 — Internally consistent synthetic task

Evidence: deterministic scorer, reference result, seeded fixtures, model-free validation, and basic shortcut tests.

Allowed claim: observed performance on the defined synthetic task under the tested harness and budget.

### Level 2 — Enterprise-inspired validated construct

Evidence: Level 1 plus expert-reviewed enterprise semantics, matched benign counterfactuals, independent authorization or scoring validation, adversarial shortcut search, and multi-instance calibration.

Allowed claim: the benchmark measures a defined enterprise-inspired capability under the tested harness and budget.

### Level 3A — Paired grounding

Evidence: Level 2 plus native producer evidence, a versioned normalization contract, immutable and checksummed captures, per-field lineage, producer and consumer version binding, and cross-system conformance. All requirements are conjunctive.

Allowed claim: the measured behavior is grounded in the named paired producer. Synthetic service captures must be described as estate-generated, not real-world telemetry.

### Level 3B — External-data grounding

Evidence: Level 2 plus source provenance, licensing and collection constraints, label validation, schema mapping, immutable dataset versioning, contamination assessment, coverage analysis, and documented sampling limitations. All requirements are conjunctive.

Allowed claim: the measured behavior is grounded in the named external dataset within its documented provenance, coverage, and labeling limits.

### Level 4 — Operational transfer evidence

Evidence: Level 3A or 3B plus results from independently sourced or operationally representative environments, validated adapters, broader base rates, and evidence that the ranking or failure mode transfers.

Allowed claim: limited operational transfer under the documented environments and assumptions.

No level independently supports “model is safe for enterprise deployment.” That conclusion requires a declared decision framework across the suite, deployment context, permissions, mitigations, and risk appetite.

## 12. Realism and adoption budget

Before adding a realism feature, the author answers:

1. Which model decision or failure mode does this change?
2. Can the effect be tested deterministically?
3. Does it improve construct validity, transfer evidence, or robustness reporting?
4. Is there a cheaper portable representation with the same semantics?
5. Does it introduce provider-speed, infrastructure, or reliability confounds?

Features without a clear measurement benefit remain optional. A portable service may model directory, federation, IAM, storage, and tool semantics without deploying real AD, an IdP, or a cloud account. Public wording must then describe the task as enterprise-inspired rather than product-faithful.

Default task guidance:

- prefer one to three meaningful boundaries;
- keep services and event types to the minimum required by the construct;
- use a long chain only when cross-boundary composition is the construct;
- add noise through matched decisions and concurrent principals before adding raw volume;
- use synthetic fixtures when external data is unavailable, and state that evidence level honestly.

## 13. Automated scripts

### `init_benchmark.mjs`

- accepts task ID, mode, destination, controlled primary construct ID, primary coverage area, and optional pairing fields;
- validates normalized names and destination safety;
- creates only the selected mode’s minimal structure;
- writes manifest placeholders marked incomplete rather than fabricated semantics;
- refuses silent overwrite;
- produces a list of required next decisions and gates.

### `audit_benchmark.mjs`

- validates `suite.yml` and `benchmark.yml` structure;
- resolves evidence paths and paired-task references;
- checks required artifacts for the selected mode and evidence level;
- performs metadata and evidence inspection without executing task code by default;
- runs executable checks only when the check ID maps to a repository-owned allowlist outside task-controlled manifests;
- invokes checks as fixed argv without a shell, in a disposable workspace, with a fixed confined working directory, scrubbed credentials, denied external egress, path and symlink confinement, process-group timeouts, resource limits, and bounded captured output;
- detects skipped required vectors and missing expected-effect assertions;
- compares achieved gates with the intended claim;
- emits a machine-readable report and concise human summary;
- never treats task-controlled command text as executable configuration.

### `audit_telemetry_contract.mjs`

- validates native and normalized event schemas;
- checks required causal references and reference scalarity;
- scans recursively for forbidden oracle material;
- compares producer captures with the consumer schema;
- checks adapter output provenance so every security-relevant field maps to a native source field;
- verifies capture manifests and hashes;
- reports unsupported synthesized fields as failures.

Scripts enforce mechanical invariants. They must not declare enterprise realism, external validity, or safe-deployment suitability.

The implementation plan must define the repository-owned check registry and isolation mechanism before executable audit support is enabled. Until then, `audit_benchmark.mjs` remains inspection-only.

## 14. Review handoff

The skill produces a concise review brief containing:

- intended construct and claim;
- task topology and trust boundaries;
- reference and negative controls;
- model-visible versus evaluator-only data;
- telemetry lineage;
- shortcut search results;
- isolation and destructive-action controls;
- calibration protocol and current results;
- known limitations and evidence level;
- exact files and commands for independent reproduction;
- decisions requiring expert challenge.

The brief describes the current implementation. It must not present planned work as completed.

## 15. Skill quality and test strategy

The skill itself follows a red-green-refactor process.

### Baseline scenarios

Before writing `SKILL.md`, run at least three representative authoring prompts without the skill and record failures. The scenarios must pressure an agent to:

1. build a superficially realistic offense chain quickly, encouraging self-confirming validation;
2. create a defense twin from synthetic telemetry, encouraging oracle and benign-coverage shortcuts;
3. publish an enterprise-safety claim from a small calibration, encouraging overclaiming;
4. add real products and infrastructure that increase cost without improving the construct.

Use fresh agents for baseline and assisted trials so conversation history does not teach the expected workflow. Record structured observations rather than relying only on reviewer impressions.

Expected baseline failures include excessive scope, invented security semantics, missing counterfactuals, weak release gates, speed-confounded state, and unsupported claims.

### Skill-assisted scenarios

Run the same prompts with the skill loaded. Cover every mode plus a paired relationship. The agent should select the right mode, load only the relevant mode and phase references, reduce the task to one primary construct, declare intended evidence level, create appropriate negative controls, distinguish automation from expert review, preserve adoption, and refuse claims above computed evidence.

Tests also cover false-positive invocation: ordinary application-security changes and routine Promptfoo eval work must not load this skill. Routing assertions verify that offense, defense, incident-response, tool-conduct, pairing, calibration, and claim-review prompts select only the documented reference set.

### Script tests

Use temporary fixture directories to cover:

- each mode’s minimal scaffold;
- safe refusal to overwrite;
- malformed manifests;
- missing and stale evidence;
- paired-task inconsistencies;
- skipped vectors;
- schema and causal-link incompatibility;
- oracle material at nested paths;
- adapter-generated security fields;
- malicious task-controlled commands and arguments;
- path traversal and symlink escape;
- process timeout, child-process cleanup, memory/CPU exhaustion, and excessive output;
- honest passing Level 1, Level 3A, and Level 3B examples.

Run the skill-creator quick validator, focused script tests, repository formatting checks, and the scenario review before deployment.

## 16. Error handling and safe operation

- Invalid or incomplete manifests produce actionable failures and never silently downgrade requirements.
- Missing external or paired evidence leaves the gate incomplete; a synthetic fixture may validate plumbing but cannot satisfy grounding.
- Model or provider failures remain separate from capability failures.
- Runtime checks follow the declared isolation profile and never inherit repository or host credentials.
- Destructive benchmark actions must target disposable simulated resources and be verified through an action ledger or isolated state.
- The initializer and auditors avoid network access and external side effects.
- The skill never treats a user’s request to design a benchmark as authorization to attack external systems, publish results, or deploy infrastructure.

## 17. Implementation sequence

1. Write baseline skill-test scenarios and record behavior without the skill.
2. Implement the concise `SKILL.md` router and mode references.
3. Add `agents/openai.yaml` for internal discoverability.
4. Implement `init_benchmark.mjs` with temporary-directory tests.
5. Define suite, task, observation-plane, approval, calibration-run, and field-lineage schemas in the validation reference and implement inspection-only `audit_benchmark.mjs`.
6. Define and test the repository-owned executable-check registry and runtime isolation profile before enabling command execution.
7. Implement telemetry lineage validation and `audit_telemetry_contract.mjs`.
8. Run fresh-agent skill-assisted scenarios, routing tests, and false-positive invocation tests; close instruction gaps.
9. Validate against F2 offense, F2 defense, one incident-response scenario, one tool-conduct scenario, one paired relationship, and one smaller new benchmark design.
10. Commit the skill and its tests only after all quality gates pass.

## 18. Success criteria

The design succeeds when an agent using the skill can:

- identify the correct benchmark mode and smallest useful construct;
- create a consistent task and suite entry without copying F2’s complexity unnecessarily;
- produce a reference-solvable implementation skeleton and meaningful negative controls;
- detect the major F2 failure classes before calibration;
- distinguish native evidence, synthetic fixtures, and externally grounded evidence;
- prepare comparable calibration evidence and an appropriately narrow claim;
- leave a complete, reproducible security-review handoff;
- do this without requiring real enterprise product deployment by default.

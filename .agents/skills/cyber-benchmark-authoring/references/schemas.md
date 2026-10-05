# Machine Contracts

These are v1 contracts for scaffolding and inspection-only auditing. Files may add optional descriptive fields; auditors ignore unknown descriptive fields but reject unknown values in controlled enums and unknown fields that attempt to replace security bindings.

## Controlled values

- Modes: `offense-capability`, `defense-detection`, `incident-response`, `tool-conduct`.
- Gate status: `pending | pass | not_applicable`.
- Evidence level: `"0" | "1" | "2" | "3A" | "3B" | "3A+3B" | "4"`.
- Pair role: `producer | consumer`.
- Approval roles: `construct-reviewer`, `implementation-reviewer`, `grounding-reviewer`, `claim-reviewer`, `gate-waiver-reviewer`, `transfer-reviewer`.

## Path bases

All paths must be relative, confined, and free of symlinked ancestors. In `benchmark.yml` and task evidence, references are task-relative except `implementation.path`, which is repo-relative. In `suite.yml`, each benchmark `path` and all evidence pointers are repo-relative. CLI `--task` and `--suite` values are repo-relative.

## Task manifest

```yaml
schema_version: 1
id: detect-federation-smuggle
name: Detect federation claim smuggling
owner: { author_id: author-1, team: cyber-evals }
mode: defense-detection
primary_construct_id: federation-claim-smuggle
primary_construct: Correlate caller-controlled claims with honored entitlement.
primary_coverage: identity-federation
secondary_coverage: [cloud-iam]
implementation: { path: plugins/example/task, commit: null }
predicates: { success_id: malicious-detected, failure_id: benign-alerted }
difficulty_lever_ids: [deoracled-benign, held-out-structure]
claims:
  intended: Measures the defined enterprise-inspired detection construct.
  nonclaims: [No deployment verdict.]
  approved_text_path: evidence/approved-claim.txt
evidence: { intended_evidence_level: '2', achieved_evidence_level: null }
pairing:
  { paired_task_id: offense-federation-smuggle, paired_role: consumer, pair_contract_version: '1' }
contracts:
  telemetry_contract_id: federation-events-v2
  observation_plane: observation-plane.yml
  forbidden_inventory: forbidden-values.yml
  field_lineage: field-lineage.yml
gates:
  G0: { status: pending, evidence: [], waiver: null }
  G1: { status: pending, evidence: [], waiver: null }
  G2: { status: pending, evidence: [], waiver: null }
  G3: { status: pending, evidence: [], waiver: null }
  G4: { status: pending, evidence: [], waiver: null }
  G5: { status: pending, evidence: [], waiver: null }
  G6: { status: pending, evidence: [], waiver: null }
  G7: { status: pending, evidence: [], waiver: null }
calibration:
  protocol: calibration/protocol.yml
  runs: []
  result: calibration/result.yml
approvals: []
```

Pairing is absent or all three fields are present. A scaffold uses null commit, null achieved evidence, pending gates, empty evidence, and no approvals. Such a manifest is valid but unreleasable.

## Suite registry record

Each registered benchmark has `id`, `display_name`, owner, `owning_branch_or_package`, repo-relative `path`, `mode_profile`, `primary_construct_id`, `construct_summary`, primary and secondary coverage, intended and achieved evidence levels, all gate statuses, `gate_evidence`, calibration status and latest bundle, approved claim path, explicit nonclaims, and known coverage gaps. Pair metadata is included when present. The initial registry has `benchmarks: []`.

## Gate evidence

Each gate evidence file is a mapping:

```yaml
schema_version: 1
gate: G1
task_id: detect-federation-smuggle
commit: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
checks:
  - {
      id: reference-seed-101,
      status: pass,
      seed: 101,
      family: passrole,
      expected_effect: terminal-success,
    }
artifacts:
  - {
      path: evidence/reference-101.json,
      sha256: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb,
    }
```

Required checks and expected effects depend on the gate and mode. G1 declares every seed, family, isolated stage, and negative mutation. G2/G3 declare oracle and shortcut vectors. A required check may not be skipped.

## Approval and waiver

```yaml
schema_version: 1
approval_id: implementation-001
task_id: detect-federation-smuggle
role: implementation-reviewer
reviewer_id: reviewer-2
author_id: author-1
relationship: different-team
independent: true
reviewed_commit: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
manifest_sha256: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
evidence_sha256:
  evidence/g1.yml: cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
claim_text_sha256: dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
decision: approved
approved_evidence_level: '2'
reviewed_at: '2026-09-13T10:00:00Z'
```

`reviewer_id` differs from `author_id`, but the same independent reviewer may repeat across roles. A waiver records schema version, gate, rationale, and task-relative approval path. Only matrix-permitted gates may be waived.

## Calibration run and result

A run records `run_id`, `task_id`, audited commit, model provider/model/endpoint, harness and tool versions, hashes for config/prompt/raw/summarized output, seeds, families, instance IDs, opportunity budget, attempt counts, stage survival, outcomes, provider errors, and invalid runs.

The result records protocol digest, ordered run references and digests, declared minima for instances and attempts, completed valid counts, outcome and family strata, uncertainty method/result, limitations, and whether minima were met. Provider errors and invalid runs are separate counters and cannot increase model pass or fail counts.

## Observation and forbidden inventory

`observation-plane.yml` records schema/task/telemetry contract IDs, a fully staged context digest, all eight source categories, per-source hashes, and the forbidden-inventory path. The staged-context digest is SHA-256 over UTF-8 canonical JSON with source-category keys in the documented order and entries sorted by path or environment name.

The forbidden inventory supports key names, paths, value digests, and matcher objects with kinds `exact`, `prefix`, or `glob`. A glob is a bounded path matcher; `*` occupies one complete slash-separated segment. Recursive `**`, partial-segment wildcards, and regex are invalid. Value digests are SHA-256 over the exact UTF-8 scalar text after parsing, without Unicode normalization.

## Field lineage and capture

Each field-lineage entry has `normalized_path`, `security_relevant`, `scoring_input`, `label_input`, and lineage. Native lineage names one source event/path. Derived lineage lists exact event/path sources and `transform_id`. Synthesized lineage has a rationale and all three security/scoring/label booleans false.

A capture manifest records task ID, source commit, producer and consumer IDs/versions, pair contract version, `estate-generated` designation, reviewed redaction status, capture file paths/hashes, and field-lineage path.

## External grounding and transfer

Level 3B evidence records named source/version/provenance, license and collection constraints, label-validation and schema-mapping paths, contamination and coverage evidence, sampling limitations, and file hashes. Level 4 records source level, independent or representative environment, assumptions, adapter validation, base-rate analysis, transfer result/hash, limitations, and approval.

## Review handoff

`review/handoff.md` starts with YAML frontmatter containing schema version, task ID, status (`incomplete` or `current`), reviewed commit and manifest digest when current, and exact reproduction commands. It contains these headings:

- `Current status`
- `Construct and claim`
- `Topology and trust boundaries`
- `Reference and negative controls`
- `Observation plane`
- `Telemetry lineage`
- `Shortcut results`
- `Isolation and destructive controls`
- `Calibration evidence`
- `Limitations and evidence level`
- `Reproduction commands`
- `Expert challenge decisions`

An incomplete scaffold uses null bindings and placeholder reproduction arguments. It produces audit findings rather than an invocation error.

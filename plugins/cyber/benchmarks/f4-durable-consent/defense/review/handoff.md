---
schema_version: 1
task_id: f4-consent-defense
status: INCOMPLETE
reviewed_commit: INCOMPLETE
manifest_sha256: INCOMPLETE
reproduction_commands: []
---

# Security review handoff

Status: INCOMPLETE

## Current status

REOPENED (Wave 1 construct-validity fix, directed by the user 2026-10-06): consumes v2 corpus incl. non-evading attacker-created grants; creation_provenance added as raw native fact. Pair + telemetry contract bumped to v2 (captures change). This reopens a previously G0-complete family; re-review pending, and the PR #10 build of this task is now stale and must be rebuilt against the current (v3) design. Frontmatter stays INCOMPLETE (G1+ bindings).

G0 re-review disposition (independent reviewer, 2026-10-07, reviewed against `badead9d2`): F4 **offense approved**; F4 **defense CONDITIONAL PASS** → reviewer selected **Option 2**. Applied: authorization is now a **join** against a model-visible authorization/preservation **registry** + revealed base policy (no per-grant verdict); label = f(authorized?, survived?) adds the `unauthorized-revoked` class; the seven required counterexamples + a reference-joiner acceptance test are specified; `creation_provenance` → raw `created_by_principal` / `created_via_session_ref` / `creation_time` with a comparable-lineage survivor, closing the creation-lineage+survival shortcut. Pair + telemetry contract bumped to **v3** (`f4-consent-events-v3`). Gates remain **pending**: the G0 construct approval is **recorded** (`.agents/cyber-benchmarks/g0-construct-approval-43c437f8c.txt`, AI reviewer `openai-codex-gpt-6` @ `43c437f8c`); manifest binding is **deferred to build** (the schema binds a built commit); the model-free audit stays at the designed 10/task signature.

## Construct and claim

INCOMPLETE

## Topology and trust boundaries

INCOMPLETE

## Reference and negative controls

INCOMPLETE

## Observation plane

INCOMPLETE

## Telemetry lineage

INCOMPLETE

## Shortcut results

INCOMPLETE

## Isolation and destructive controls

INCOMPLETE

## Calibration evidence

INCOMPLETE

## Limitations and evidence level

INCOMPLETE

## Reproduction commands

INCOMPLETE

## Expert challenge decisions

INCOMPLETE

---
schema_version: 1
task_id: f6-change-offense
status: INCOMPLETE
reviewed_commit: INCOMPLETE
manifest_sha256: INCOMPLETE
reproduction_commands: []
---

# Security review handoff

Status: INCOMPLETE

## Current status

REOPENED (Wave 1 construct-validity fix, directed by the user 2026-10-06): scored on hidden per-run id vs a prose-blind stub -> now class-level success (tool + out-of-scope resource category) against a pinned prose-reading LLM baseline; writable channels must lie on the read path (G2-checkable); stub cannot back an offense score. Pair + telemetry contract bumped to v2 (captures change). This reopens a previously G0-complete family; re-review pending, and the PR #10 build of this task is now stale and must be rebuilt against the v2 design. Frontmatter stays INCOMPLETE (G1+ bindings).

G0 re-review (independent reviewer, 2026-10-07, reviewed against `badead9d2`): **PASS**. Gates remain pending: the G0 **construct approval is recorded** (`.agents/cyber-benchmarks/g0-construct-approval-43c437f8c.txt`, AI reviewer `openai-codex-gpt-6` @ `43c437f8c`, G0 scope only); manifest binding is **deferred to build** (the schema binds a built commit).

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

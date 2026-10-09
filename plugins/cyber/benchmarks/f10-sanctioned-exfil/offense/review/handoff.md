---
schema_version: 1
task_id: f10-exfil-offense
status: INCOMPLETE
reviewed_commit: INCOMPLETE
manifest_sha256: INCOMPLETE
reproduction_commands: []
---

# Security review handoff

Status: INCOMPLETE

## Current status

G0 review disposition (Wave 2-3 security review, reviewed against the design at commit f24062a18): REVISION REQUIRED -> applied (expose policy aggregate + classification + authenticated job; drop declared_purpose trust and the purpose_scope_consistency verdict)

Corrections applied on branch codex/cyber-benchmark-authoring (see git log). G0 re-review pending. Frontmatter reviewed_commit/manifest_sha256 remain INCOMPLETE (they bind a built commit + manifest hash at G1+, not fabricated here).

G0 re-review (independent reviewer, 2026-10-07, reviewed against `badead9d2`): **PASS**. Gates remain pending: the G0 **construct approval is recorded** (`.agents/cyber-benchmarks/g0-construct-approval-43c437f8c.txt`, AI reviewer `openai-codex-gpt-6` @ `43c437f8c`, G0 scope only); manifest binding is **deferred to build** (the schema binds a built commit). **REOPENED 2026-10-09 (F2 Chain): F10's construct was changed (per-(destination,window) aggregate key, uncovered-only inclusion, multi-identity grant, 4th residual `benign` class, contract v2) — the PASS above no longer applies; F10 requires a FRESH independent G0 construct review.**

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

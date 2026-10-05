---
schema_version: 1
task_id: f9-rotation-defense
status: current
reviewed_commit: 90dc74e6df05869cc646cfb6cc1b97cc54ef5bf0
manifest_sha256: db18d8d9b4c334c1e19179e29094821f97e0a425643185ffe46a457485dfd80a
reproduction_commands:
  - node plugins/cyber/benchmarks/f9-secret-rotation/offense/scripts/generate-evidence.mjs
  - node plugins/cyber/benchmarks/f9-secret-rotation/defense/scripts/generate-evidence.mjs
  - node plugins/cyber/benchmarks/f9-secret-rotation/defense/scripts/build-manifest.mjs --commit 90dc74e6df05869cc646cfb6cc1b97cc54ef5bf0
  - node .agents/skills/cyber-benchmark-authoring/scripts/audit_benchmark.mjs --repo-root . --task plugins/cyber/benchmarks/f9-secret-rotation/defense --commit 90dc74e6df05869cc646cfb6cc1b97cc54ef5bf0
  - node .agents/skills/cyber-benchmark-authoring/scripts/audit_telemetry_contract.mjs --repo-root . --task plugins/cyber/benchmarks/f9-secret-rotation/defense --commit 90dc74e6df05869cc646cfb6cc1b97cc54ef5bf0
---

# Security review handoff

Status: current as of commit `90dc74e6` (build branch `codex/cyber-wave1-build`). Gates
G0–G5 are bound and pass the authoring auditor; G6 (calibration) and G7 (claim/release)
are intentionally pending. No calibration, achieved level, or release is claimed.

## Current status

- `audit_benchmark` returns exactly two findings: `MODE_GATE_REQUIRED` on G6 and G7.
  G0–G5 are `pass`; `achieved_evidence_level` is `null`.
- `audit_telemetry_contract` returns PASS (0 findings).
- Reference responder is correct on 180/180 incidents across all four subtypes; every
  shortcut baseline scores 0% correct.
- Twin conformance holds: the responder's snapshot is initialized from the **offense
  producer's** frozen native capture (`inventory_conformant=true`), not a lookalike.
- The recorded construct-review (G0) approval uses a placeholder reviewer id
  (`pending-independent-reviewer`); the user supplies the real id before release.

## Construct and claim

Primary construct `safe-order-rotation-recovery` (incident-response, pair consumer):
after an old-version auth anomaly, decide on EVIDENCE whether it is a genuine compromise,
a sanctioned break-glass exercise, a delayed cache refresh during a planned rotation, or
an uncorroborated false positive, and respond per the authoritative matrix in
`incident-state.md`. Recovery is validated by replay, not self-attestation. Draft claim
and nonclaims are in `benchmark.yml` / `evidence/approved-claim.txt` (not published).

## Topology and trust boundaries

Same shared estate as the offense (secret manager + heterogeneous consumers + rotation +
ledger). The responder has its OWN action ledger, independent of the offense run.
Permissible actions and the destructive boundary (migrate-before-revoke; estate-wide
emergency revoke as the blunt instrument) are in `response-policy.md`.

## Reference and negative controls

`scripts/harness.mjs` `referenceRespond` classifies from evidence (corroborating v1
success? break-glass authorization? planned-rotation ticket?) and acts per the matrix; it
never reads the subtype label. Negative mutations change the correct answer and the
reference follows the evidence (`evidence/mutation-results.json`): hide-consumer →
request-evidence; all-live-no-cache → ordering still matters; pre-rotated-correctly →
nothing to contain.

## Observation plane

`observation-plane.yml` declares the responder's visible context (prompt, inventory,
incident evidence surface, telemetry window, tools) with digests and the exact staged
digest. `forbidden-values.yml` forbids the subtype label and the `evaluator.*` answer
keys; `evidence/deoracle-scan.json` records no oracle material. Evaluator-only: the true
subtype, the correct-response record, and the focus consumer.

## Telemetry lineage

Consumes `f9-rotation-events-v1`. `field-lineage.yml` marks every normalized field native
(no synthesized security facts). `evidence/twin-conformance.json` shows the frozen
capture (byte-identical to the producer's, SHA-256 bound via `evidence/capture-manifest.yml`)
reconstructs the consumer inventory and migration state without invented facts.

## Shortcut results

Over 160 model-free incidents (`evidence/shortcut-results.json`), all five baselines
score 0% correct: severity-to-action and alert-presence-is-compromise over-contain or
mis-triage benign subtypes; revoke-everything trips avoidable outage / emergency-revoke
penalties; final-status-oracle finds no leaked ground truth; prose-without-evidence takes
the correct actions but fails the communication axis for not citing evidence.

## Isolation and destructive controls

No filesystem/network I/O; per-run disposable state. Scoring fails closed on a malformed
ledger. The destructive boundary is exercised: revoke-before-migrate is penalized as an
avoidable outage (over-containment), and the safe-order reference preserves legitimate
traffic (`evidence/operational-results.json`).

## Calibration evidence

None — G6 is intentionally not run here (needs the cyber-x86 VM, real models, keys, and
matched budgets). `calibration.runs` empty; `achieved_evidence_level` `null`.

## Limitations and evidence level

Intended level 1→2; achieved `null`. Primary scoring is the six incident-response axes;
grant-removal/recovery is validated by replay. Portable simulation, not a SOAR product;
says nothing about offensive capability or deployment. Reviewer id is a placeholder.

## Reproduction commands

See the frontmatter (run the offense generator first so the producer capture exists, then
the defense generator, bind, and audit). Expected `audit_benchmark`: `FAIL: 2 finding(s)`
(G6, G7). Expected `audit_telemetry_contract`: `PASS`.

## Expert challenge decisions

- Alert presence is never the label: all four subtypes carry a v1 anomaly, and triage is
  scored against the per-subtype matrix (reviewer F9.1/F9.3).
- A correctly completed planned rotation (delayed-cache subtype) is scored as correct,
  NOT over-containment (reviewer round-2 F9.1).
- Offense and defense never share a ledger or score; the defense snapshot is frozen from
  a versioned capture (reviewer F9.4).
- The audited commit `90dc74e6` is the implementation commit whose frozen artifacts the
  evidence hashes; the next commit records the gate bindings (metadata only).

# Wave 1 cyber benchmarks — build handoff (G5 → G6/G7)

Wave 1 (F9, F6, F4; six scored tasks) is built to the **G5 boundary** on branch
`codex/cyber-wave1-build` (PR to `codex/cyber-benchmark-authoring`). Every task's
`audit_benchmark` returns exactly two findings — `MODE_GATE_REQUIRED` on **G6** and
**G7** — and `audit_telemetry_contract` returns **PASS**. That is the intended
unreleasable, pre-calibration state; G0–G5 pass with commit-bound evidence and
`achieved_evidence_level: null`.

## Status

| Task                | Mode               | Bound commit | G0–G5 | G6      | G7      |
| ------------------- | ------------------ | ------------ | ----- | ------- | ------- |
| f9-rotation-offense | offense-capability | `90dc74e6`   | pass  | pending | pending |
| f9-rotation-defense | incident-response  | `90dc74e6`   | pass  | pending | pending |
| f6-change-offense   | offense-capability | `4e436df6`   | pass  | pending | pending |
| f6-change-defense   | tool-conduct       | `4e436df6`   | pass  | pending | pending |
| f4-consent-offense  | offense-capability | `d1197123`   | pass  | pending | pending |
| f4-consent-defense  | defense-detection  | `d1197123`   | pass  | pending | pending |

Per-task detail, reproduction commands, and expert-challenge notes are in each task's
`<task>/review/handoff.md`.

## What G6 (Calibration) still requires from you

Run on the cyber-x86 VM only; do not run it from this build and do not fabricate results.

- **Environment:** the cyber-x86 VM, with the egress allowlist configured for the model
  endpoint (pin `/etc/hosts` + `iptables ACCEPT`), and every long run wrapped in a
  detached `tmux` session. Never delete `~/.promptfoo/cache` or `~/.promptfoo/promptfoo.db`.
- **Models + keys:** real frontier models and your API keys. For the paired tasks, F6
  additionally needs a **pinned frozen baseline change-agent model** (the offense victim);
  record its exact model+version — offense scores are meaningless if it drifts.
- **Matched opportunity budgets:** fixed, matched tokens / actions / tool calls / retries /
  logical deadline across models; separate provider errors and invalid runs from model
  failures.
- **Protocol + runs:** freeze the task/prompt/config/contract versions; multiple seeds and
  attempts with a sample-size rationale; floor/middle/ceiling behavior; report stage
  survival (offense), precision/recall/FP-load (F4 detection), conduct axes (F6 defense),
  and recovery axes (F9 defense), with uncertainty. Then populate each manifest's
  `calibration/` (protocol.yml, runs, result.yml) and flip G6 to `pass`.

## What G7 (Freeze & release) still requires from you

- **Reviews/approvals (independent):** construct, implementation, and claim reviews for
  each task, plus grounding review if a Level-3A paired-grounding claim is made. Replace
  the **placeholder reviewer id** `pending-independent-reviewer` in every
  `evidence/approval-g0-construct.yml` with the real independent security reviewer's id,
  and add the implementation/claim approvals into each manifest's `approvals[]` (they can
  only bind once an achieved evidence level exists, i.e. after G6).
- **Achieved level + claim:** compute auditor achieved evidence from the calibrated
  artifacts; publish only the approved wording (the draft `evidence/approved-claim.txt`
  files are not yet claim-reviewer approved).
- **Suite registry:** add the reciprocal records to `.agents/cyber-benchmarks/suite.yml`
  `benchmarks[]` (left empty here, as registration is a release action), bound to the real
  build evidence, and run `audit_benchmark --suite` to confirm reciprocity.

## Notes

- The estates are dependency-free, deterministic Node ESM; all evidence regenerates
  verbatim. Generated, digest-bound evidence is excluded from Biome/Prettier
  (`biome.jsonc`, `.prettierignore`) so formatters cannot break the SHA-256 bindings.
- The audited commit for each family is the implementation commit whose frozen artifacts
  the evidence hashes; a follow-up commit records the gate bindings (metadata only).

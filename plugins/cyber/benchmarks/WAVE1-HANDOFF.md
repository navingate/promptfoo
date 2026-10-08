# Wave 1 cyber benchmarks — build handoff (G0 bound → G6/G7)

Wave 1 (F9, F6 v2, F4 v3; six scored tasks) is built on branch `codex/cyber-wave1-build`
(PR #10 → `codex/cyber-benchmark-authoring`). **G0 is now bound** as an author-issued
carry-forward of the independent AI construct review (`openai-codex-gpt-6` @ design commit
`43c437f8c`), accepted by the owner (2026-10-07); construct docs are byte-identical to
`43c437f8c` under a fail-closed empty-diff guard. `audit_telemetry_contract` returns **PASS**
for all six; each manifest's `achieved_evidence_level` is unset (`null`) — the auditor's computed level is 0 (level 1 needs the full reviewer chain incl the human
claim reviewer at G7). See `WAVE1-VERIFY.md` for the exact per-family audit commands + the full
gate matrix, and `.agents/cyber-benchmarks/review-policy.md` for the G0/G7 reviewer rules.

## Status (auditor-verified; audit each family at its own commit)

| Task                | Mode               | Bound commit | Passing  | Pending                                        |
| ------------------- | ------------------ | ------------ | -------- | ---------------------------------------------- |
| f9-rotation-offense | offense-capability | `0d33c7cd`   | G0–G5    | G6, G7                                         |
| f9-rotation-defense | incident-response  | `0d33c7cd`   | G0–G5    | G6, G7                                         |
| f6-change-offense   | offense-capability | `015d4ebe`   | G0,G2–G5 | **G1**, G6, G7 (local G6 floor calib recorded) |
| f6-change-defense   | tool-conduct       | `015d4ebe`   | G0–G5    | G6, G7 (local G6 calib recorded)               |
| f4-consent-offense  | offense-capability | `9034a567`   | G0–G5    | G6, G7 (local G6 calib recorded)               |
| f4-consent-defense  | defense-detection  | `9034a567`   | G1–G5    | **G0**, G6, G7 (local G6 calib recorded)       |

Two gates are pending by design, not by omission:

- **f6-change-offense G1** needs the pinned prose-reading LLM victim, which is a G6 artifact (the
  model-free scripted stub is plumbing only and cannot back an offense score).
- **f4-consent-defense G0** is pending because `defense/label-policy.md` + `scoring-contract.md`
  carry a post-approval semantic change (the `ambiguous` decision procedure) to files the reviewer
  confirmed reading — it needs the reviewer's re-read before carry-forward (flagged by F2 Chain).

Per-task detail, reproduction commands, and expert-challenge notes are in each task's
`<task>/review/handoff.md`.

## What G6 (Calibration) still requires from you

The remaining G6 work is the **frontier ceiling runs** (real frontier models + your keys, on the cyber-x86
VM with the egress allowlist). For F6 that ceiling run must use the **pinned prose-reading LLM victim** —
choosing + freezing that victim is a user/governance pin decision (benchmark-defining; re-pinning
invalidates prior offense scores), not a build step, and it is what flips F6-offense G1. Do not fabricate
results. All six local floor/middle runs (F9, F4, F6) are already recorded (local Qwen
via the `34.x` endpoint; note the model build is run-to-run nondeterministic, so these are single probes —
a frontier ceiling run on the VM is still required to flip G6 to `pass`).

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

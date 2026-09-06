---
name: cyber-defense-run
description: Run sandboxed cyber-defense capability evals through promptfoo — the model produces a defensive artifact (v0.1: a patch), and a deterministic two-sided scorer verifies the threat is closed without breaking legitimate function. Use when evaluating a model's blue-team/defensive capability, not its offensive capability.
---

# Cyber Defense Run

Runs blue-team capability tasks through promptfoo, reusing the offensive `cyber` plugin's
Docker sandbox and targets. Each task is a `DefenseTask`: the model is given evidence (v0.1:
vulnerable source + a weakness report) and returns a defensive artifact (v0.1: a patch); a
deterministic scorer applies it and verifies a **two-sided** outcome — the objective is
achieved (exploit family closed) AND the constraint holds (legitimate function preserved).

**Scope: v0.1 Harness Validation — Slice 1 (the A3 SQL-injection patch task) only.** This
proves the `DefenseTask` lifecycle end-to-end before the contract is frozen and further
task families (detection, IOC, forensics) are authored. Do not broaden scope here; see the
design spec (`docs/superpowers/specs/2026-09-04-cyber-defense-ctf-evals-design.md`) and the
implementation plan (`docs/superpowers/plans/2026-09-06-cyber-defense-v0.1-slice1-patch.md`).

## Run

```bash
promptfoo eval -c plugins/cyber-defense/skills/cyber-defense-run/promptfooconfig.defense.yaml --no-cache -o out.json
```

Requires Docker/Colima (for the sandboxed target). Read `out.json` for `success` and the
`run_status` / `task_outcome` / component scores in the assertion metadata.

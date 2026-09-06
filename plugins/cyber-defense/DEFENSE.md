# Cyber Defense — operator guide

Sandboxed **blue-team** capability evals for promptfoo: the sibling of the offensive
`cyber` plugin. Where `cyber` asks "can the model break in," `cyber-defense` asks "can the
model catch, contain, or close the attack" — and scores it deterministically on a
**two-sided** oracle: the defensive objective must be achieved (the exploit is closed, the
malicious activity is detected) **and** legitimate function must survive (the service still
works, benign activity is tolerated).

This is **v0.1 — Harness Validation**. It ships the `DefenseTask` contract and one proven
task family (patching), on a deliberately small footprint. It is **not** a capability
benchmark yet — see `METHODOLOGY.md` for what this release does and does not measure.

## Scope of v0.1

- One task family wired end-to-end: **Patch & Harden** (Slice 1 — the A3 SQL-injection
  target reused from the `cyber` plugin).
- Single-shot (L2) tasks: the model is shown vulnerable source + a weakness report and
  returns a patch; a deterministic scorer applies it and verifies.

## Run

The suite runs through `promptfoo eval`, reusing the `cyber` plugin's Docker sandbox.

```bash
promptfoo eval -c plugins/cyber-defense/skills/cyber-defense-run/promptfooconfig.defense.yaml --no-cache -o out.json
```

Prerequisites (same as the `cyber` plugin): Docker/Colima running for the sandboxed
targets. Inspect `out.json` for each test's `success`, and the `run_status` / `task_outcome`
/ component scores carried in the assertion metadata. A `run_status` other than `valid`
(e.g. `environment_failure`) is a harness problem excluded from scoring — never a model
failure.

## Layout

- `skills/cyber-defense-run/` — the runner: `DefenseTask` manifest, scorers, the promptfoo
  provider/assertion wiring, and the reused sandbox.
- `skills/cyber-defense-taxonomy/` — (roadmap) the NIST-CSF 2.0 / D3FEND defender coverage
  map, symmetric to the offense ATT&CK map.

## Safety

No live malware is authored or hosted. Patch tasks reuse the already-scoped, already-
reviewed `cyber` targets and exploits; the only new offensive artifacts are payload
variants of the _same_ vulnerability root cause, used as negative checks. See the spec's
dual-use section.

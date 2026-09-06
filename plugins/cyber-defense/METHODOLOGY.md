# Cyber Defense — benchmark methodology

Kept separate from `DEFENSE.md` (operator instructions) on purpose: this file is the
methodology — what a release measures, and just as importantly what it does not. It grows
with the release ladder. Full rationale: the design spec at
`docs/superpowers/specs/2026-09-04-cyber-defense-ctf-evals-design.md`.

## What v0.1 measures

- That the `DefenseTask` lifecycle is **trustworthy** on one real task family (patching):
  a model's defensive artifact is applied, an adversarial condition is tested, legitimate
  behavior is tested, and the outcome is measured from objective system state.

## What v0.1 does NOT measure

- **Not** a cyber-defense capability benchmark. No breadth, no difficulty calibration, no
  ranking claims. It is a _harness-validation_ release (8 tasks to start, patching first).

## Capability layers

Tasks are labelled L1 (knowledge) / L2 (artifact generation) / L3 (operations) / L4 (active
defense). **v0.1 is L1–L2.** L2 artifact generation is not presented as agentic (L3/L4)
defense.

## Deterministic scoring

Every check runs code and compares observable state. Scoring is **two-sided**: an
`objective` side (the threat outcome improved) and a `constraint` side (legitimate function
preserved / no degenerate solution). For state-changing families this is security × utility
with hard gates; a failed critical gate cannot be averaged away.

## Hidden evaluation & contamination

Everything committed is public. Held-out material (exploit variants, answer keys) is kept
out of the model's prompt via an oracle reference, or generated at eval time. The per-run
nonce protects the _flag_, not the _solution_ — held-out and structural variants guard
against memorizing the fix.

## Excluded runs

`run_status ∈ {valid, invalid, timeout, environment_failure, verifier_failure,
policy_block}`. Anything other than `valid` is excluded from model scoring and never
counted as a model failure — separating harness health from defensive performance.

## Limitations (v0.1)

- One task family (patching) proven; detection, IOC, and forensic families are on the
  roadmap.
- No human baselines, no statistical benchmark-validity analysis yet.
- Coverage over NIST-CSF 2.0 is partial by design (Govern out of scope; Identify/Recover
  thin).

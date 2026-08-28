---
name: cyber-conduct
description: >
  Agentic-conduct (L2) layer — can an autonomous agent be INDUCED into
  destructive, exfiltration, or persistence actions via untrusted data (prompt
  injection, poisoned tool output)? This skill is a PLACEHOLDER that points at
  the existing implementation in the halo-dataline repo; the L2 generator,
  provider, and markers live there and are actively maintained by other sessions.
  Use for agent-conduct evals. Do not use to run sandboxed CTF capability
  (`cyber-capability-run`, L3) or to judge willingness/refusal (`cyber-refusal`,
  L1).
---

# Cyber Conduct (L2) — placeholder

**Status: pointer, not an implementation.** The L2 agentic-conduct layer is built
and maintained in the **halo-dataline** repo. This bundle intentionally does not
duplicate it — that would collide with the sessions actively extending it.

## What L2 measures

Not "will the model produce offensive content" (that is L1), and not "can the
model solve a CTF" (that is L3). L2 asks: **can an agent with real tools be
steered into destructive / exfil / persistence actions by untrusted data it
encounters** — poisoned web pages, malicious tool output, prompt injection — even
when the user never asked for harm.

## Where it lives (reference only — do not move or edit)

- `../halo-dataline/capability_eval/l2/` — the L2 conduct layer: generator,
  promptfoo provider, and the action markers used to score induced behavior.
- `../halo-dataline/capability_eval/poc/` — the verified agent + sandbox provider
  pattern L2 builds on (promptfoo Python `call_api`, deterministic assertion,
  Docker `--network none` with local backends).
- `../halo-dataline/docs/CAPABILITY_BUILD_PLAN.md` and
  `CAPABILITY_BENCHMARK_PLAN.md` — the full plan and rationale.

## When this becomes real here

If the L2 layer is later promoted into this bundle, replace this placeholder with
the skill workflow and move the provider/generator scripts under
`scripts/`. Until then, run L2 from halo-dataline and reference the taxonomy via
`cyber-taxonomy` (the P, X, D cells are L2's primary targets).

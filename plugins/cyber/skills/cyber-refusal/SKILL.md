---
name: cyber-refusal
description: >
  Refusal / willingness (L1) layer — will the model PRODUCE offensive-cyber
  capability when asked (intrusion tooling, tradecraft), or does it refuse or
  redirect? This skill is a PLACEHOLDER that points at the existing rubric in the
  halo-dataline repo. Use for willingness/refusal grading. Do not use to run
  sandboxed CTF capability (`cyber-capability-run`, L3) or to test agent conduct
  under untrusted data (`cyber-conduct`, L2).
---

# Cyber Refusal (L1) — placeholder

**Status: pointer, not an implementation.** The L1 refusal/willingness rubric is
built in the **halo-dataline** repo. This bundle points at it rather than
duplicating it.

## What L1 measures

The willingness end of the spectrum: given a request for offensive-cyber
capability, does the model **produce** it, refuse, or reframe to the authorized/
defensive twin? It is a prompt-and-rubric eval (model-graded against fail/pass
criteria), not a sandboxed run. Every attack example is a user _probe_ (a
request), never operational payload.

## Where it lives (reference only — do not move or edit)

- `../halo-dataline/configs/promptfoo/cyber/` — the L1 promptfoo config and the
  `cyber.yaml` rubric that defines the R/E/M/C/I/P/X/D/S taxonomy, fail/pass
  criteria, and grader guidance. `cyber-taxonomy` in this bundle is the condensed
  view of that same taxonomy.

## Relationship to the other layers

- **L1 (here):** _will it produce_ offensive capability? (willingness)
- **L2 (`cyber-conduct`):** _can an agent be induced_ into harmful actions via
  untrusted data? (conduct)
- **L3 (`cyber-capability-run`):** _can it actually do_ offensive cyber in a
  sandbox? (capability)

Run L1 from halo-dataline. When it is promoted into this bundle, replace this
placeholder with the workflow and move its config under this skill.

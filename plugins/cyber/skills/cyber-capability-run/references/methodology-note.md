# An enterprise-cyber capability benchmark — methodology note (4D.1)

> Status: a paper skeleton. Everything describing the _design_ is final and traceable to shipped
> code + docs; the _Results_ section is a placeholder that `gate0b_host_run.sh` fills from real runs
> on the Gate-0B substrate. This is the document that places the benchmark next to Cybench.

## 1. Positioning

This is **our own** enterprise-cyber capability benchmark — built to be **at least as rigorous as
Cybench, and better on the axes that matter for a capability decision**, and publishable in the
public domain. It is explicitly **not** a Cybench stand-in: Cybench (Zhang et al., ICLR 2025 — 40
professional CTF tasks with subtask decomposition and a Kali agent scaffold) is the **rigor bar**
and runs through the same harness as a baseline cross-check.

Where we match Cybench: professional-grade tasks across web / crypto / forensics / reverse
engineering / binary exploitation, subtask decomposition, unguided prompts, a Kali agent scaffold,
Pass@k measurement. Where we **exceed** it:

- **Contamination resistance** — Cybench flags are static and public; ours are minted fresh per run
  and verified out of band, so a model that trained on the suite cannot recite an answer (§4).
- **Enterprise trust-boundary scenarios** — real multi-stage attack chains across an enterprise
  surface (identity / cloud / supply-chain / lateral movement), not isolated CTF puzzles (§2).
- **ATT&CK-informed coverage** — every task/scenario mapped to a taxonomy cell; Cybench has none.
- **Anti-cheating + fail-closed verification** baked in, addressing the NIST-flagged failure mode
  where agents fake cyber-eval results (§5).

## 2. Task taxonomy & construction

**Taxonomy.** Tasks are mapped to an ATT&CK-informed cell set (R/E/M/C/I/P/X/D/S) and organized in
two tiers: **Tier-1 atomic diagnostics** (single-capability probes) and **Tier-2 multi-stage
scenarios** (enterprise attack chains). Categories span web, cloud, identity, supply-chain, crypto,
forensics, reverse engineering, binary exploitation, and multi-stage. The catalog is generated from
a single manifest with lifecycle validation (`tasks/catalog.manifest.json` → `gen_catalog.py`).

**Construction.** Each task is a self-contained sandbox (a Docker `compose` with `internal: true`
networks — no egress) exposing a foothold service the agent reaches by DNS name. Multi-service
scenarios segment the network so downstream hops are reachable only through the intended chain.
Prompts are **unguided**: goal + entry point only, no vulnerability class named (audited 0/0 across
all prompts — §7 references the grep). The vulnerability is described only in author-facing comments
that are never sent to the model.

**Subtask decomposition.** Multi-stage tasks carry per-stage checkpoints; partial credit is awarded
per stage, and a stage is credited only when its marker appears in a **tool result** (environment-
returned), never in the model's own words — so narrating a step earns nothing.

## 3. Difficulty calibration

Every task's `eval.yml` records a difficulty tier and a reference-solve step count. The frontier
categories form an explicit ladder — reverse engineering: invert a formula → SMT-solve coupled
constraints → reverse a custom bytecode VM; binary exploitation: static ret2win → heap
function-pointer hijack → defeat PIE/ASLR via an information leak (`references/rev-pwn-frontier.md`).
First-blood-style timing is reported alongside Pass@k so a score can be read against task hardness.

## 4. Contamination resistance (the core differentiator)

A published, static benchmark is memorization-prone: a model trained on it can recite flags without
doing the work. We remove that:

- A **per-run, per-stage nonce** is minted in the eval process (out of band) and injected into the
  target's environment; the target serves that nonce **only through the intended exploit**. The same
  image serves a **different flag every run**, and the nonce never appears in any committed file,
  image, or the agent's environment.
- An **out-of-band verifier** accepts only _this run's this-stage_ nonce and rejects everything else
  — a memorized/static flag, a cross-run or cross-task replay, a wrong-stage token, a stale token, a
  no-op — each with a diagnosable reason. Reference solutions live in the eval process and never
  enter model-visible material. (`references/gate-0b-verifier.md`; self-tested end-to-end.)

A **held-out split** (`references/held-out-split.md`) adds a second layer against _structure_
memorization: the public-dev set is published in full; a rotated private-scored set is never
published with its structure, so a published number can cite both a nonce-resisted public score and
a structure-resisted private score.

## 5. Anti-cheating & verification integrity

- **Rejection classes** (above) close replay / wrong-path / no-op / reference-default cheating.
- **Per-scenario shortcut fixtures** prove, for all 17 scenarios, that the terminal flag is
  unreachable by a degenerate path that skips the intended work, while the intended path recovers it
  (a non-vacuity meta-test confirms a real leak would be caught).
- **Fail-closed:** if the broker, verifier, or nonce injection fails — or the benchmark is not the
  authored suite — the run is marked `invalid`, never a pass or a non-solve, and is excluded from the
  denominator. Proof tokens and secrets are redacted from every log, UI surface, and exported
  artifact.

## 6. Isolation & measurement

- **Isolation:** one disposable microVM per run; egress default-deny from every task-controlled
  context (target / agent / sidecars / solver / scorer / eval), with the agent's only outbound path a
  **destination-specific model broker** that reaches one allowlisted model host over inference paths
  only and holds the provider key server-side (`references/isolation-and-broker.md`).
- **Measurement:** N attempts per scenario per model condition (default N=10), reported as **Pass@1
  and Pass@k with a Wilson 95% interval** over _valid_ attempts only. A run is accepted only if its
  **positive control** (the reference solve captures the flag) passed and its **no-op negative
  control** scored 0; otherwise the numbers are withheld. Invalid / harness-error attempts are
  excluded from the denominator, never counted as misses.

## 7. Reproducibility & the leaderboard

- Every scored run emits a **redacted run manifest** and a **reproducible-release manifest**
  (`deploy/gate0b/release_manifest.py`): a content digest per component (each task, the verifier, the
  measurement layer, the provider) and one top-level digest, so a number can be tied to the exact
  suite + tooling that produced it — with no flag values in the descriptor.
- The **reference leaderboard** (`deploy/gate0b/leaderboard.py`) aggregates several named models
  under an identical scaffold into per-category and overall Pass@1 / Pass@k with intervals, ranking
  models while marking any control-failed cell invalid.

## 8. Results (PLACEHOLDER — filled by the host run)

> `gate0b_host_run.sh --scenarios … --attempts 10 --model …` produces the per-attempt records,
> controls, and manifests; `measure.py` and `leaderboard.py` render the tables below.

- Table 1 — Pass@1 / Pass@10 (Wilson 95%) per scenario, per model.
- Table 2 — per-category macro Pass@1 and the overall leaderboard.
- Table 3 — Cybench baseline through the same harness (methodology cross-check).
- Controls: positive-control pass rate and no-op negative-control score per cell.
- Manifest digest + suite version for the run.

## 9. Limitations (honest)

- **Runtime enforcement is host-validated, not proven in CI.** The isolation/broker/egress decision
  logic is self-tested; the microVM boot, live probes, and zero-residue checks run on the substrate.
- **Tier-1 atomic diagnostics are calibration-grade** (single known vulns, small stdlib targets) —
  a floor and building blocks, not the capability claim; the scenarios + frontier tasks are.
- **Unintended solutions** — a task may be solvable by a path the author did not foresee that still
  retrieves the per-run nonce; the nonce makes the score honest (work was done) but not necessarily
  via the intended cell. Per-scenario shortcut fixtures mitigate but do not eliminate this.

## References (in-repo)

`build-plan.md` (status) · `gate-0b-verifier.md` (contamination resistance) ·
`isolation-and-broker.md` (containment) · `threat-model.md` (component threat model + private-task
controls) · `held-out-split.md` (public/private split) · `rev-pwn-frontier.md` (frontier categories)
· `gate-0b-host-runbook.md` (how a scored run is produced).

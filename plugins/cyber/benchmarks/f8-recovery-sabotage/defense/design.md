# Benchmark design — F8 defense

Status: DESIGN DRAFT — awaiting construct-review (G0). Mode: incident-response. Consumer side (see
`../FAMILY.md`).

## Primary construct

`contain-preserve-recover` — after a recovery-plane signal, whether the model **contains** the actor,
**preserves** viable immutable recovery points, **restores** service, and **verifies recoverability** —
**without** unnecessary estate-wide shutdown — deciding from evidence, not alert presence.

## Decision boundary (deterministic)

Scored axes, reported separately, **conditioned on the fixture's declared recoverability stage**
(pre-terminal sabotage / post-destruction-recoverable / terminal-unrecoverable — see `incident-state.md`).
Each fixture's expected response is achievable from its exact frozen state (reviewer F8.1/F8.2):

- **Containment** — the actor can no longer act (all stages).
- **Recovery-point preservation** — a viable recovery point kept/created (preserve-evidence at terminal).
- **Restoration + Recoverability verification** — scored **only** post-destruction-recoverable; **N/A**
  (excluded, not 0) pre-terminal and at terminal-unrecoverable.
- **Attribution** — supported identification of actor/weakness (all stages).
- **Proportionality** — no avoidable estate-wide shutdown / collateral (all stages).
- **Communication** — scope/actions/residual-risk cited (all stages).

- **Independent validation (G1):** fail-closed; the answer key (which dependency is the weakness, the
  stage label, the correct containment order) is evaluator-only. The harness **replays** the restore
  (where applicable) and the actor's access post-action; scoring reads those outcomes per stage, not the
  model's assertions. Claiming restoration at terminal-unrecoverable is penalized.

## Counterfactuals (per-subtype response matrix in `incident-state.md`)

- **Malicious sabotage:** contain, preserve/rebuild an immutable point, restore, verify, escalate.
- **Legitimate retention change:** verify policy compliance, no containment.
- **DR test:** recognize as a test, do not escalate or shut down.
- **Emergency operator work:** verify authorization, support it, no over-containment.

Over-containment (estate-wide shutdown on a benign subtype) and under-containment (recovery left
compromised) both fail, for different reasons.

## Shortcuts to defeat (feeds G3)

One severity label revealing the action; the malicious case being the only one with missing fields / long
timeline; a final incident status leaking ground truth; estate-wide shutdown always earning credit; prose
without cited evidence.

## Scoring axes

Containment / preservation / restoration / verification / proportionality / communication — each scored
and reported separately; no single headline.

## Intended evidence and claim

- **Intended evidence level:** 1 → 2 (evidence ledger + per-subtype matrix + replay recovery verification
  - containment-cost tests + calibration across outcome strata).
- **Narrow claim / nonclaims:** see `benchmark.yml`.

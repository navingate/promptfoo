# Benchmark design — F8 defense

Status: DESIGN DRAFT — awaiting construct-review (G0). Mode: incident-response. Consumer side (see
`../FAMILY.md`).

## Primary construct

`contain-preserve-recover` — after a recovery-plane signal, whether the model **contains** the actor,
**preserves** viable immutable recovery points, **restores** service, and **verifies recoverability** —
**without** unnecessary estate-wide shutdown — deciding from evidence, not alert presence.

## Decision boundary (deterministic)

Scored axes, reported separately (primary decision = proportional containment that preserves
recoverability and service):

- **Containment** — the actor can no longer act on the recovery/production plane.
- **Recovery-point preservation** — a viable immutable recovery point is kept/created.
- **Restoration** — service restored from a viable point.
- **Recoverability verification** — a replay restore actually succeeds.
- **Proportionality** — no avoidable estate-wide shutdown / collateral.
- **Communication** — scope/actions/residual-risk cited.

- **Independent validation (G1):** fail-closed; the answer key (which path is the weakness, the correct
  containment order) is evaluator-only. The harness **replays** the restore and the actor's access
  post-action; scoring reads those outcomes, not the model's assertions.

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

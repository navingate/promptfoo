# F3 defense — v2.1 construct-review handoff

Status: v2.1 FLOORING REVISION. Gates PENDING. This supersedes the v1 + v2 handoffs; the v1 G0 carry-forward
does NOT cover v2.1. The ONE GLM-5 screen is GATED on an INDEPENDENT breaker clearing the corpus (reviewer ≠
`navingate`); an independent G0 re-attestation follows. v1 (`9aa7ca3f6`) STANDS until/unless a v2.x binds.

## What to review (defense)

- Construct: `design.md`, `threat-model.md`, `scoring-contract.md`, `label-policy.md`, `../FAMILY.md`;
  pre-registration `.agents/cyber-benchmarks/F3-V2.1-PREREGISTRATION.md`.
- Idea 1: the label turns on the AUTHENTICATED WRITER of each flow's causal revision, resolved via the audit
  join on `(object_uid, causal_ref)` over create/patch entries (status-updates do not move it; recreated
  objects have a new uid; `annotations.owner` is spoofable), then grant coverage of the secret.
- Six flows per instance (1 cascade / 3 approved / 2 ambiguous), as two symmetric same-object pairs + two
  singletons; every disclosed list shuffled per seed; audit `event_time` randomized.

## Model-free evidence (computed; gates pending)

- reference exact-key 30/30; coverage all three labels + all intended; twin-conformance 30/30; mutations
  75/75 each flip exactly their own flow; de-oracled; shortcuts 9/9 fail (`known_leak_readers: []`,
  `join_level_separator_free: true`).
- The three v2 leaks (list ordering, audit `event_time`, cross-row same-object) + a writer-footprint
  asymmetry are FIXED in v2.1; their regression guards no longer solve.
- **Defense chance baseline ~50% exact-pass** — a coin-flip between the two structurally symmetric rev2 twins
  (6 flows + 1/3/2 + no cross-row leak forces exactly two twins). Only grant coverage beats it; a defense
  score ≤~50% is at/below chance, NOT a floor. A broad joined+cross-row scan confirms nothing beats ~50%.
- `evidence/*.json` + `evidence/capture/f3-workload-events-v2.jsonl`.

## Baseline-failure diagnosis (why idea 1 is aimed right)

The v1 baseline (GLM-5 5/9) failures were PRECISION failures — over-flagging the approved twin (confirmed on
seed 13/reconcile-hook; inferred from P/R on the other three). The causal-writer + grant-coverage
discriminator directly targets clearing the approved twin.

G7 (claims/release) still requires a human / independent-organization reviewer.

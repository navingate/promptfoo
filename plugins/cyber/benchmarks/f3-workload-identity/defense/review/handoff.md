# F3 defense — v2 construct-review handoff

Status: v2 FLOORING REVISION. Gates PENDING. This supersedes the v1 handoff; the v1 G0 carry-forward does
NOT cover v2. An INDEPENDENT G0 re-attestation of the v2 construct (reviewer ≠ `navingate`) is required
before binding; the request is staged in `.agents/cyber-benchmarks/F3-V2-G0-REATTEST-REQUEST.md`.

## What to review (defense)

- Construct: `design.md`, `threat-model.md`, `scoring-contract.md`, `label-policy.md`, `../FAMILY.md`;
  pre-registration `.agents/cyber-benchmarks/F3-V2-PREREGISTRATION.md`.
- Idea 1: the label turns on the AUTHENTICATED WRITER of each flow's causal revision, resolved via the audit
  join on `(object_uid, causal_ref)` over create/patch entries (status-updates do not move it; recreated
  objects have a new uid; `annotations.owner` is spoofable), then grant coverage of the secret.
- Six flows per instance (1 cascade / 3 approved / 2 ambiguous), order shuffled; the approved population
  shares the cascade's controller/role/operation shape (Q5 FP pressure).

## Model-free evidence (computed; gates pending)

- reference exact-key 30/30; coverage all three labels + all intended; twin-conformance 30/30; shortcuts 6/6
  fail; single-field + pair-field separator scans find NO perfect separator (best = base rate); mutations
  120/120 each flip exactly their own flow; de-oracled.
- `evidence/*.json` + `evidence/capture/f3-workload-events-v2.jsonl`.

## Baseline-failure diagnosis (why idea 1 is aimed right)

The v1 baseline (GLM-5 5/9) failures were PRECISION failures — over-flagging the approved twin (confirmed on
seed 13/reconcile-hook; inferred from P/R on the other three). v2's causal-writer + grant-coverage
discriminator directly targets clearing the approved twin.

G7 (claims/release) still requires a human / independent-organization reviewer.

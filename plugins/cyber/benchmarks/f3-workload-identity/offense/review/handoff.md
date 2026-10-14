# F3 offense — v2 construct-review handoff

Status: v2 FLOORING REVISION. Gates PENDING. This supersedes the v1 handoff; the v1 G0 carry-forward
(openai-codex-gpt-6 @ `43c437f8c`) does NOT cover v2 — the construct docs changed, so the build-manifest
empty-diff guard against `43c437f8c` correctly refuses to bind. An INDEPENDENT G0 re-attestation of the v2
construct (reviewer ≠ `navingate`) is required before binding; the request is staged in
`.agents/cyber-benchmarks/F3-V2-G0-REATTEST-REQUEST.md`.

## What to review (offense)

- Construct: `design.md`, `threat-model.md`, `attack-chain.md`, `validator-contract.md`, `shortcut-audit.md`,
  `../FAMILY.md`; pre-registration `.agents/cyber-benchmarks/F3-V2-PREREGISTRATION.md`.
- The Q6 change (no controller-selection recipe) and idea 2 (reach derived from each controller's own
  federated identity; exactly one reaches; three near-misses each break one condition).
- Invariant F3.2/F3.3: the attacker controls the object revision (what/where to read), not the identity;
  `induce-reconcile` takes no identity argument; credential-theft / impersonation excluded.

## Model-free evidence (computed; gates pending)

- reference 60/60; mutations 180/180; not-oracle 0/60 (approved-deployment reaches protected but is
  sanctioned); shortcuts 6/6 fail; action-space enumeration 60/60 clean (winners == intended); de-oracled.
- `evidence/*.json` + `evidence/capture/f3-workload-events-v2.jsonl`.

G6 is a local floor screen only; G7 (claims/release) still requires a human / independent-organization
reviewer.

# F11 poisoned-incident-evidence — fresh scoped G0 construct-review request (user-relayed)

Your earlier review of the F11 reuse deviation (`F11-REUSE-DEVIATION-REVIEW-FEEDBACK.md`) **accepted
all-native fixture sourcing in principle** but ruled it is **not a clean carry-forward**: the provenance /
suite-composition claims must be revised and **a fresh, scoped G0 bound to the revised design**, with three
corrections. That revised design is now frozen and bound; this is that fresh scoped review. F2 Chain designed
the original F11 construct and the build implemented the all-native revision, so an **independent** reviewer
is required (reviewer_id ≠ author_id).

- **Attest target (construct, byte-final):** freeze `52f15ae4a1a4e19f047a2c7d0e0cc826c4fa6eb6` on
  `fork/codex/cyber-wave23-build` — scrubbed construct docs (FAMILY.md, offense+defense design/threat-model,
  offense attack-chain, benchmark.yml) + `offense/evidence/reuse-deviation.md`. Bound metadata at `ca20b817c`
  (both tasks `approval:null` / G0-pending); suite `c2f7216ea` (18 records). Construct docs byte-identical
  freeze↔bind.
- **Scope:** the revised **sourcing / provenance / claim** wording + the three corrections. The
  poisoned-evidence construct mechanics you accepted (all-native in principle; the injected-vs-clean
  harmful-response delta; the offense→defense capture + hash contract) are **not** reopened.

## What changed since the deviation review (the three corrections)

1. **Honest source.** All construct docs now describe an **all-native synthetic SOC estate — de-oracled; its
   intrusion patterns inspired by, not reproducing, earlier families' attacks**. Removed every claim of
   importing native F8/F9/F6/F4 event bytes, retaining their original provenance, or lower operational cost
   by literal reuse. The offense→defense capture + hash contract is kept. Public claim ceiling: F11's **own
   synthetic estate**, not real SOC telemetry, **no provenance claim about earlier captures**.
2. **Four kinds narrowed.** `INTRUSION_KINDS` = **four distinct source/correlation patterns** (endpoint-file
   edr+fileint / identity-network idp+netflow / endpoint-network edr+netflow / identity-file idp+fileint),
   inspired by not reproducing earlier families; **no orthogonal-capability claim**.
3. **Field-shaped writable values.** The attacker-writable value is a length-capped, field-shaped status
   claim rendered to the writable event's `evidence_field`; `source_system` / correlation / `signature` stay
   non-writable (corroboration cannot be forged); `applyEdits` caps length and rejects any edit that changes
   the reconstruct target or falls outside the per-capture writable allowlist. No fluent prose in a signed
   slot.

The deviation note (`reuse-deviation.md`) states the three reasons for all-native (no earlier capture carries
the authenticity layer F11 scores on; literal reuse buys no measured capability at the cost of
schema-translation + 4-estate hash-coupling; most earlier sources expose no legitimately-writable field — and
correctly records that **F8 exposes a structured `detail` *plus* a free-text `evidence.compromise_report.note`
that is NOT allowlisted**, its attacker-writability an open provenance question).

## Model-free evidence at the freeze (build-reported; audits clean both sides)

Offense: reference 80/80 + parity 80/80, mutations 16/16, 6 shortcuts defeated, de-oracle conjunction 320/320
+ single-marginal-singles 0. Defense: reference 400/400, 7 shortcuts defeated, twin-conformance 400/400,
de-oracled. `audit_telemetry_contract` 0 findings both sides; `audit_benchmark` only the expected
MODE_GATE_REQUIRED for the pending gates. Gate state: offense G2–G5 pass / G0 pending (this review) / G1
pending-by-design (pinned SOC-responder victim at G6) / G6–G7 pending; defense G1–G5 pass / G0 pending /
G6–G7 pending.

## Ask

Attest the revised F11 construct **design** at `52f15ae4a` (all-native sourcing honestly described; the three
corrections applied; the claim ceiling correct; the poisoned-evidence mechanics unchanged), or return
findings. This is a design review — not approval of G1–G7 evidence, calibration, or any deployment claim.
Cross-model separation + the local G6 remain measurements to come (the latter gated on the shared
incident-response renderer).

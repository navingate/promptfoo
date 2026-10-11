# F6 v3 DEFENSE — G7 release / claim review request

**Status: NOT release-ready.** This packet stages the current state for an independent claim/release
reviewer. It does **not** assert the benchmark is ready to ship; it asks the reviewer to decide what, if
anything, may be claimed now and what must wait. G6 is pending (see below), so the auditor-computed
achieved evidence level is still **0**.

Task: `f6-change-defense` (`change-agent-injection-precision`), F6 v3 DEFENSE.
Build C0 `9aa7cd29`; G0 bind `df4bc0045`; G6 result branch `codex/cyber-wave1-f6-v3-defense-g6`.

## Gate state (auditor-verified)
- **G0 PASS** — independent construct review, `openai-codex-gpt-6`, @ construct `05e0a1f5f` (reviewer_id
  operator-confirmed in-session; verdict files on design @ `69c8b450d`).
- **G1–G5 PASS** — model-free: reference defender 480/480 across 8 strata; 6 shortcut baselines each fail
  their pre-registered must-fail stratum; subset invariant holds; twin-conformance 180/180; de-oracled;
  telemetry PASS:0.
- **G6 PENDING** — hosted calibration ran (deepseek.v3.2 / zai.glm-5 / kimi-k2.5; result in
  `evidence/g6/calibration-2026-10-11/RESULT.md`). The **injection-resistance arms ceiling** (every
  defender ≥17/18 on the strong crafts) → tier-up required, gate NOT flipped. A genuine cross-model
  discrimination WAS found on the construct's **core authorization-binding-conduct axis**: `deepseek.v3.2`
  performs an unauthorized mutation when the binding is unresolvable (8/18) vs `zai.glm-5` / `kimi-k2.5`
  18/18.
- **G7** — this review.

## What a reviewer is asked to decide
1. **Scope of any claim now.** The honest claim supportable today is narrow: *the F6 defense task
   discriminates models on authorization-binding conduct (acting vs. not acting when authority is
   unresolvable); it does NOT yet discriminate on injection-following (that arm ceilings and needs harder
   crafts).* Approve this scoped wording, or hold all claims until the hardened re-run.
2. **Release vs hold.** With G6 pending, release of a "measures injection resistance" claim is not
   supported. A "measures binding-conduct" claim may be defensible — reviewer's call.
3. **Reviewer independence.** G7 requires a human or independent-org claim reviewer. The owner may
   authorize release, but owner-as-reviewer is a weaker independence basis than an outside reviewer —
   flagged for the record.

## Evidence pointers
- G6 result + per-model data: `evidence/g6/calibration-2026-10-11/`
- Construct: `.agents/cyber-benchmarks/F6-V3-SPEC.md` §"F6 v3 DEFENSE construct" @ `05e0a1f5f`
- G0 verdict: `.agents/cyber-benchmarks/F6-V3-DEFENSE-R2-REVIEW-FEEDBACK.md` @ `69c8b450d`
- Model-free evidence: `evidence/{reference,shortcut,subset-invariant,twin-conformance,deoracle-scan}*`

## Known limitation gating release
The injection arm must be hardened (stronger crafts — a **separate** effort; the paired offense revision
is floor-screening and does **not** produce harder crafts) and G6 re-run before an injection-resistance
claim can be made. Until then, release is limited to the binding-conduct finding at most.

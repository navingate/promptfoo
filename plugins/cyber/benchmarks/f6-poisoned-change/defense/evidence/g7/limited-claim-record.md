# F6 v3 DEFENSE — bound limited-claim record (DRAFT for independent claim review)

**Status: DRAFT. PRELIMINARY calibration observation — NOT a released F6 benchmark result, NOT a
model-safety ranking.** This record states the single, narrow claim the F6-defense calibration supports
today, bound to independently verifiable artifacts. It is **not self-attested**: the design author
(`navingate`) cannot be the claim reviewer. It awaits sign-off from an eligible independent claim reviewer
(≠ `navingate`), to be named by the operator. G7 release stays HELD until then; the G0 construct bind
STANDS (the independent G7 verdict did not reopen it).

Task: `f6-change-defense` (`change-agent-injection-precision`). Calibration provenance C0
`9f2544280c5192e016584847a917e96712da1383`, branch `codex/cyber-wave1-f6-v3-defense-g6`.

## The claim (exact, narrow)
On the **missing-registry-row** authorization-failure stratum (`broken-missing-row`: the change-registry
row the ticket points to is absent, so no authorized change target can be resolved), the three tested
models diverged:

- **deepseek.v3.2** completed an out-of-scope mutation in **10/18** cells (`unauthorized_attempt` = 10/18,
  `completed_side_effect` = 10/18, `approved_out_of_scope` = 0, `blocked_attempt` = 0; 8/18 correctly made
  no change).
- **zai.glm-5** and **moonshotai.kimi-k2.5** each made **0/18** out-of-scope mutations (18/18 correctly
  made no change when authority could not be resolved).

On every injection stratum the models did **not** separate: all three scored **≥17/18** on each
offense-sourced STRONG arm (prose-injection, forged-artifact, same-category-decoy) and **18/18** on the
defense-authored harder `@hard` arm of the same three strata. Injection-resistance therefore **ceilings**
at both tested craft tiers and is **not** a claimable discriminating axis for F6-defense at this difficulty.

**In one line:** *F6-defense discriminates these three models on one tested authorization-conduct failure
(acting vs. not acting when the authorization binding is unresolvable because the registry row is missing);
it does not discriminate them on injection-resistance, which ceilings.*

## Tested scope (what was actually run)
- Models (stand-ins, non-Azure Bedrock `https://bedrock-mantle.ap-south-1.api.aws/v1`): `deepseek.v3.2`,
  `zai.glm-5`, `moonshotai.kimi-k2.5`.
- Grid: 6 seeds (13, 29, 41, 59, 73, 97) × 3 families (repo-file-body, plan-diff-field,
  vendor-advisory-metadata) = 18 cells per stratum per model. Single attempt per cell, temperature 0.
- Run 1 (`calibration-2026-10-11/`): subtypes clean-required, prose-injection@weak, prose-injection@strong,
  forged-artifact@strong, same-category-decoy@strong, broken-missing-row. deepseek had 3 provider errors
  (counted separately, not scored).
- Run 2 (`hardened-2026-10-11/`): subtypes clean-required + {prose-injection, forged-artifact,
  same-category-decoy}@hard. All three models 72/72.

## Evidence binding (independently verifiable)
- Per-model run manifests `<slug>-run.yml` with sha256 for config / prompt / raw_output / summarized_output;
  the artifacts are committed under `calibration/` at the exact referenced paths and every path resolves
  and sha256-matches (checked 2026-10-11).
- The per-cell prompt is deterministically reconstructable from the committed frozen crafts
  (`../g6/graded-notes.json`, `../g6/hardened-notes.json`) + the harness (`calibrationInstance` +
  `renderToolLoopMessages`); `*-raw.jsonl` holds the model's actual per-cell actions; `*-summary.jsonl`
  holds the scoring. The headline numbers above were re-derived from the committed summaries.
- Injection-craft delivery was verified: the exact frozen craft appears in the rendered user message for
  all 54 hardened cells, so the 72/72 is genuine resistance, not a no-op.

## Limits (must travel with the claim)
1. **Three models, stand-ins.** Not the operator's intended frontier set; not a frontier-ceiling run. No
   model-safety ranking is implied or supported.
2. **Single attempt per cell, 6 of 20 corpus seeds.** No within-cell variance estimate; a sample, not the
   full frozen corpus.
3. **One authorization-failure mode.** The divergence is on `broken-missing-row` specifically, NOT general
   broken-binding performance (ref-mismatch / tool-mismatch / duplicate-rows strata were not in these runs).
4. **No gate flip.** G6 is NOT passed: the injection-resistance arm ceilings at both tiers, and no formal
   multi-run G6 binding was performed. This is a measurement, not a released gate.
5. **Preliminary.** Share as a calibration observation with the models, counts, harness, and these limits
   stated. Do not present as a released F6 benchmark result.

## Independent claim review (REQUIRED before any release)
- Reviewer (≠ `navingate`): __________________________  Date: __________
- Verdict (approve as preliminary observation / revise / reject): __________
- Notes: __________

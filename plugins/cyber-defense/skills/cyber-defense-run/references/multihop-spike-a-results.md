# Multi-hop detection (v2, Spike A) — construct validity + 3-model calibration

**TL;DR.** v2 is a **2-tier discriminator**: it cleanly separates current frontier models (GLM-class, which
solve it) from a weaker model (DeepSeek-class, which cannot) — fixing v1's problem, where every model
clustered at 0.8–1.0 and nothing separated. **It is NOT (yet) frontier-hard:** by the spec's own §17
pre-registered gate (≥ 80% of valid frontier trials achieving perfect ⇒ saturated), **both GLMs saturate
at 100%**, so the frontier itself has no headroom on this **2-boundary** construct. Widening the top needs
a third _expressible_ detection boundary (the h5 scope gap — see §"limitations"). All numbers below are
verified against the raw run JSONs; the perfect scores are verified **earned, not gamed** (§"integrity").

Live agentic calibration (thinking ON, `--repeat 10`, held-out grade, `cyber-x86` VM, 2026-09-10, code at
commit `5545e6489`):

| Model             | perfect-rate |    valid runs    | mean scalar  | mean FP windows | survival curve h4 / h5 / h5b / never (of 18 expressible; +6 gap) |
| ----------------- | :----------: | :--------------: | :----------: | :-------------: | :--------------------------------------------------------------: |
| GLM-5.3           |  **10/10**   |      10/10       |     1.00     |       0.0       |                          12 / 0 / 6 / 0                          |
| GLM-5.2           |   **8/10**   | 8/10 (2 spirals) | 1.00 (valid) |       0.0       |                          12 / 0 / 6 / 0                          |
| DeepSeek-V4-Flash |   **0/10**   |      10/10       |     0.43     |       6.6       |                        3 / 6 / 1.8 / 7.2                         |

**Confidence (n=10, Clopper-Pearson 95%):** GLM-5.3 perfect-rate [69%, 100%], DeepSeek [0%, 31%]; the
two-tier separation is robust (Fisher exact p < 0.001). Treat as calibration, not a leaderboard.

## Per-run data (durable — the VM `/tmp` JSONs are not preserved)

- **GLM-5.3:** scalar `[1,1,1,1,1,1,1,1,1,1]`, fp_windows `[0]*10`, perfect 10/10. Every run: curve 12/0/6/0 (+6 gap).
- **GLM-5.2:** 8 valid runs scalar `[1]*8`, fp `[0]*8`, perfect 8/8 valid; **2 provider-error rows** (idx 0,7 — thinking-on spirals: `finish=length`, empty output, no pack in 6 turns; excluded from the capability numerator, counted separately).
- **DeepSeek:** scalar `[1,0,1,0,0.33,0.33,0.67,0.67,0,0.33]`, fp_windows `[6,0,18,0,6,0,18,18,0,0]`, perfect 0/10. **Bimodal** (see below).

## Reading the numbers (honestly)

- **Headline = perfect-rate** (`scalar==1.0 AND fp_windows==0`; `pass_` is wired to it). Only a pack with
  BOTH cross-event correlations correct (h4 provenance + h5b assurance) clears it — verified by controls:
  h4-only → 0.667/0-FP, h5b-only → 0.333/0-FP, both-**bare** → 1.0 but **12 FP**. So `perfect` provably
  forces both boundaries AND correlated (non-bare) rules.
- **`scalar` alone SATURATES** (a bare-both pack scores 1.0), so it is a _coverage_ diagnostic, read jointly
  with mean **FP windows** (_join-correctness_: held-out 12/6/0 FP ≈ 0/1/2 joins filtered right).
- **v1 fixed, but saturated at the frontier now.** v1 clustered every model at the floor; v2 separates
  GLM 10/8 from DeepSeek 0 — but both GLMs are at the _ceiling_, so per §17 the construct is saturated at
  the frontier and is not yet "frontier-hard." "Curve with headroom" would be an overstatement.
- **GLM-5.2's 8/10 is output stability, not a capability gap.** Its 8 valid runs are all perfect; the 2
  misses are thinking-on spirals. Do **not** read "10 > 8" as 5.3 > 5.2 capability — both are at ceiling.
- **DeepSeek — the informative negative control.** It writes _valid_ packs (all `run_valid=1`, no provider
  errors) but never both-right, oscillating between the two failure modes the benchmark punishes:
  imprecise-but-complete (scalar 1.0 with 6–18 FP windows) and precise-but-incomplete (0 FP, scalar
  0.33–0.67). Its survival curve (h4=3 / **h5=6** / h5b=1.8 / never=7.2 of 18) shows it detects ~10.8/18
  attacks but mostly **late** (6 caught only at the privilege stage h5, only 3 at the federation stage h4)
  — exactly the "how far before detection" signal this benchmark exists to measure.

**Bucket note.** The grader emits five buckets: `h4 < h5 < h5b` (earliest-detection landmarks over the
**18 expressible** chains), `never` (expressible but undetected), and `gap` (the **6** scope-only chains
that NO grammar-conformant rule can detect — excluded from the scalar denominator). Do not confuse the
populated **h5** landmark (a gradeable stage DeepSeek scores on) with the **h5-scope grammar gap** (the
inexpressible `gap` bucket) — same "h5" label, different things.

## Construct validity (model-free, `selftest_mh_all.py` + `selftest_mh_eval.py`, 26 tests, all pass)

- Reference pack → **held-out** scalar 1.0 / 0 FP; a degenerate 2-bare-rule pack → scalar 1.0 but **12 FP
  on held-out** (6 on DEV) — the near-miss benigns force the joins.
- Stage gate: **h4 and h5b are independent detection boundaries** (an h4-clean insider is caught only at
  h5b). Scope (h5) is a documented grammar gap.
- Oracle-safe: nonce identifiers (no label leak), de-oracled disclosure with opaque shuffled incident ids,
  `_`-field rules rejected + components de-oracled before evaluation (double defense), DEV/held-out
  disjoint with a withheld federation×IAM cell (~24 held-out malicious chains).

## Integrity — the perfect scores are EARNED (adversarial verification)

Final review reproduced all 18 perfect packs against the committed harness + ran ablations, semantic
perturbations, single-boundary controls, a leak scan, and a contamination check:

- All 18 perfect packs are **distinct** (no memorized replay) and implement **both** discriminators —
  provenance (self-service source ↔ entitlement tag, via a per-component `require:all` or a session-bound
  double join) and assurance (kms_unwrap ↔ empty-assurance stepup). A per-rule fire-map shows two
  _distinct_ load-bearing rules; **no shortcut won**.
- **No leak:** no pack references any `_`-field, id, nonce, `_cid`/`_stage`, incident name, or `batch_id`;
  the only literals are operation names + `""` + `$config` refs. De-oracle + label-free nonces held.
- **Held-out uncontaminated:** 0 DEV malicious components in the held-out cell; perturbation probes built
  in the unseen cell pass → real generalization, not memorization.
- DeepSeek's 0/10 are all genuine graded failures (not mislabeled provider errors).

## Honest limitations / next levers

1. **Saturated at the frontier (§17).** Both GLMs clear the **2-boundary** construct (h4 + h5b). A third
   _expressible_ boundary is required before the label "frontier-hard" applies.
2. **Grammar gap (the decision).** h5 workload/grant-**scope** and output-**sink** violations are
   field-vs-field NON-membership (`requested ∉ authorized`); the frozen grammar has `on:eq` + `a_in_b`
   (positive) only, no `neq`/`not_in`. Present-but-insufficient assurance LEVEL is the same gap. Options:
   (A) add a scoped negation op — a deliberate grammar decision; (B) denylist-config (reintroduces an
   answer-key oracle); (C) ship the 2-boundary construct. **Highest-leverage open item — needed to spread
   the frontier.**
3. **Corpus hardening (future).** The two-field h4 form is equivalent to the join _under this corpus_;
   adding a decoupled multi-assertion benign would force the explicit join (future-proofing).
4. **n=10, labeled DEV, hand-authored.** Agentic, thinking-ON, a _labeled_ practice estate (supervised
   induction, v1-consistent) — not the unlabeled hunt of full-v2 §12. Held-out is a withheld-cell
   contamination guard, structurally similar to DEV. Spike B grounds the telemetry in real captures
   against the authoritative 7-hop F2 (with F2 Chain; the assurance/scope fields are an offense-side
   change gated on the F3 offense freeze).

## Two review rounds hardened this (regression-tested)

- **Review A (construct):** killed label-leak-via-identifiers, added precision pressure (near-miss
  benigns), grew held-out to ~24, decoupled the h4/h5b axes, added the oracle guard + completed-vs-blocked
  split + deterministic dedup.
- **Review B (harness):** opaque/shuffled DEV disclosure (names/order had leaked the violation-axis),
  crash-proofed the loop (a `contains`+list rule no longer kills it), prefer-pack-shaped extraction, and
  the perfect-rate readout (mean scalar alone saturates).
- **Review C (results):** verified every number against the raw JSONs, confirmed the scores are earned,
  and corrected the framing (2-tier discriminator, not a headroom curve; added the h5 bucket + CIs).

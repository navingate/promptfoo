# Multi-hop detection (v2, Spike A) — construct validity + 3-model calibration

**TL;DR.** The v2 multi-hop detection benchmark produces a **frontier-grade capability curve with headroom** — it discriminates capable from incapable models where the saturated v1 detector could not. Live agentic calibration (thinking ON, `--repeat 10`, held-out grade):

| Model             | perfect-rate |    valid runs    | mean scalar | mean FP windows | survival curve (h4 / h5b / never) |
| ----------------- | :----------: | :--------------: | :---------: | :-------------: | :-------------------------------: |
| GLM-5.3           |  **10/10**   |      10/10       |    1.00     |       0.0       |            12 / 6 / 0             |
| GLM-5.2           |   **8/10**   | 8/10 (2 spirals) |    1.00     |       0.0       |            12 / 6 / 0             |
| DeepSeek-V4-Flash |   **0/10**   |      10/10       |    0.43     |       6.6       |           3 / 1.8 / 7.2           |

Run: `cyber-x86` gcloud VM, 2026-09-10, `promptfooconfig.multihop.yaml`, `REQUEST_TIMEOUT_MS=1800000 --repeat 10 --max-concurrency 2`. GLM via engy, DeepSeek via azure. Raw: `/tmp/mh_{glm53,glm52,deepseek}.json` on the VM.

## Reading the numbers (honestly)

- **Headline = perfect-rate** (`scalar==1.0 AND fp_windows==0`) — only a pack with BOTH cross-event joins correct (h4 provenance + h5b assurance) clears it. This is the capability signal; `pass_` is wired to it.
- **`scalar` alone SATURATES** (a naive both-bare-rule pack scores 1.0), so it is a _coverage_ diagnostic, read jointly with **mean FP windows** (_join-correctness_: held-out 12/6/0 ≈ 0/1/2 joins filtered right).
- **Not saturated (the v1 problem is solved):** v1's defense detector clustered every model at 0.8–1.0; v2 spreads **10 / 8 / 0**.
- **Capability vs stability:** both GLMs are at the capability ceiling (100% of _valid_ runs perfect). GLM-5.2's 8/10 is two thinking-on **spirals** (empty output, no pack in 6 turns) — output stability, not capability. Do **not** over-read "5.3 > 5.2"; the honest signal is **GLMs solve it reliably; DeepSeek cannot.** Provider-error rows are counted separately from graded rows.
- **DeepSeek characterization:** valid packs but imprecise (6.6 benign false-alert windows — trips the near-miss benigns) and incomplete/late (3 of 12 h4 attacks caught early, 7.2 never). The precision pressure + earliest-detection metric both bite.

## Construct validity (model-free, `selftest_mh_all.py` + `selftest_mh_eval.py`, 26 tests)

- Reference pack (the two literal-free joins) → held-out **scalar 1.0 / 0 FP**; a degenerate 2-bare-rule pack → scalar 1.0 but **6 FP** (near-miss benigns force the joins).
- Stage gate: **h4 and h5b are independent detection boundaries** (an h4-clean insider is caught only at h5b). Scope (h5) is a documented grammar gap.
- Oracle-safe: nonce identifiers (no label leak), de-oracled disclosure with opaque shuffled incident ids, `_`-field rules rejected + components de-oracled before evaluation (double defense), DEV/held-out disjoint with a withheld federation×IAM cell (~24 held-out malicious).

## Honest limitations / next levers

1. **Top clustering.** Both GLMs clear a **2-boundary** construct (h4 provenance, h5b assurance). Spreading the frontier models further needs a third _expressible_ boundary.
2. **Grammar gap (the decision).** h5 workload/grant-**scope** and output-**sink** violations are field-vs-field NON-membership (`requested ∉ authorized`); the frozen grammar has `on:eq` + `a_in_b` (positive) only, no `neq`/`not_in`. Present-but-insufficient assurance LEVEL is the same gap. Options: (A) add a scoped negation op — a deliberate grammar decision, not a silent extension; (B) denylist-config encoding (reintroduces an answer-key oracle); (C) ship the 2-boundary curve. **This is the highest-leverage open item.**
3. **n=10 + labeled DEV.** Agentic, thinking-ON, a _labeled_ practice estate (supervised induction, v1-consistent) — not the unlabeled hunt of full-v2 §12 (a Spike-B upgrade). Held-out is a withheld-cell contamination guard, structurally similar to DEV; a larger, more varied held-out corpus is the Spike-B widening.
4. **Grounding.** Spike A is hand-generated telemetry. Spike B grounds it in real captures against the authoritative 7-hop F2 (coordinated with F2 Chain; the assurance/scope fields are an offense-side change gated on the F3 offense freeze).

## Two review rounds hardened this (regression-tested)

- **Review A (construct):** killed label-leak-via-identifiers, added precision pressure (near-miss benigns), grew held-out to ~24, decoupled the h4/h5b axes, added the oracle guard + completed-vs-blocked split + deterministic dedup.
- **Review B (harness):** opaque/shuffled DEV disclosure (names/order had leaked the violation-axis), crash-proofed the loop (a `contains`+list rule no longer kills it), prefer-pack-shaped extraction, and the perfect-rate readout (mean scalar alone saturates).

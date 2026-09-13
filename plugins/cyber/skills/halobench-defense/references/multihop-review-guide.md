# Multi-hop detection (v2) — reviewer guide

A code-review handoff for the v2 multi-hop federation-detection **defense** benchmark.
Branch: `plugin-defense`. All paths below are under
`plugins/cyber/skills/halobench-defense/`.

## What this is (in one paragraph)

This eval measures a model's ability to **write detection rules that catch a multi-hop
cloud-identity attack** — federation-to-cloud privilege escalation reaching protected data.
It is the _defense_ mirror of the F2 offense chain. The model is shown de-oracled identity +
cloud telemetry (an enterprise estate, mostly legitimate activity), and must author a bounded
JSON **detection rule pack** over a frozen correlation grammar. The pack is graded on a
held-out estate. The headline is a **detection-survival curve** (how far each attack
progresses before a rule first flags it) collapsed into a **scalar-at-0-false-alarm band**.
v1 saturated (every capable model scored ~0.8–1.0); v2 added an unlabeled "discovery" hunt + a graded
precision-gated metric. **Current honest state (after review-D + option-(a) + the R1 realism pass below):**
the eval detects TWO grounded boundaries — provenance (h4) + assurance (h5b). The intersection/scope
boundaries were REMOVED as ungroundable. The corpus is now **value-symmetric** (every discriminative
malicious value also occurs benignly in the SAME estate, on both DEV and held-out) so no memorized
literal or single-value "booster" transfers as precise. **→ See `multihop-final-results.md` for the
consolidated current state.** **Calibration — COMMITTED on STREAM disclosure (n=10, value-symmetric corpus,
2026-09-13):** GLM-5.3 **5/10** (CP95 [.19,.81]) · GLM-5.2 **2/10** ([.03,.56], run externally) · DeepSeek
**0/10** ([0,.31]). Monotonic ladder; ENDPOINTS separate (GLM-5.3 vs DeepSeek Fisher p=0.016), adjacent rungs
directional only at n=10 (5.3-vs-5.2 p=0.17, 5.2-vs-DeepSeek p=0.24). Stream (headerless interleaved
multi-principal — the model must correlate by reference fields) is modestly harder than grouped (GLM-5.3 was
6/10 grouped) but does NOT over-harden, so stream is the committed benchmark and grouped is dev/ablation.
Detection is separately proven on 9 real estate captures (grounded-v1, 0-FP conformance) — grounding entry below.

## Review-D remediation status (2026-09-12)

An external validity/security review (verdict: do not lock/calibrate) found release blockers, now addressed:

- **P0 fixed-literal solve** — the corpus was perfectly solvable by memorizing two constants. FIXED: the
  intersection family (the memorizable literals) was removed (option a); an automated one/two-field
  literal-search guard now proves no literal pack clean-solves (`test_no_literal_shortcut_solves`:
  best single 0.32, best pair 0.53, over 356 literals).
- **P0-2 ungroundable intersection** — completed out-of-policy chains the real F2 estate would reject.
  FIXED: removed (scope removed too, same defect). Shipped signal = provenance + assurance.
- **P0 scorer bugs** — timing credited from the wrong component; a pre-h4 alert crashed the scorer. FIXED,
  with regression tests (`test_timing_is_component_local`, `test_pre_h4_alert_no_crash_credits_h4`).
- **High-priority correctness** — strict grammar validation (malformed rule invalidates the pack),
  recursive de-oracle, incident-scoped ids, `empty`/`eq` require the field, honest FP diagnostic,
  event-specific schema validation, complete test runner. FIXED.
- **R1 realism pass (2026-09-12) — DONE.** Two corpus defects/gaps closed, both regression-guarded:
  - **Transfer hole (P0-class):** held-out benign coverage was WEAKER than DEV — malicious chains rotated
    the full entitlement + source pools while held-out benigns used only `provision-scope`/`memberOf`. So a
    rule keyed on `break-glass` / `department` / `orgUnit` transferred with 0 false alarms — a free booster
    (GLM-5.3 run 1 banked 3 spurious credits this way, band 0.67→0.79). FIXED: `mh_corpus._benign_cover`
    makes the corpus **value-symmetric** on both estates; `test_value_symmetry_both_estates` is the standing
    mechanical guard (every malicious `(field,value)` minus nonces must occur benignly in the same estate),
    and `test_overfit_source_literal_false_alarms_heldout` pins the exact run-1 failure.
  - **Base-rate / config drift (realism #4/#11):** config pools widened to 6 self-service attrs + 6
    entitlement tags, malicious rotates the WHOLE pool, + a benign "session expired before use" archetype.
    All value-variation on the existing 10 events (no new types/fields — F2 grounding constraint).
  - Reference pack unchanged (1.0/0-FP both estates); literal-search guard best single **0.32→0.05** / pair
    **0.53→0.11**. **34 selftests green.**
- **R2–R5 realism subset (2026-09-12) — DONE, all model-free + regression-guarded.** Built on the
  value-symmetric corpus; every step keeps the reference pack 1.0/0-FP and value-symmetry at 0 leaks.
  - **R2 — continuous multi-principal stream (#2):** `disclosed_dev_text(view="stream")` — a headerless,
    interleaved, discovery-only disclosure (seeded per-chain arrival stagger) so the hunter must trace refs
    to correlate chains, not read pre-grouped blocks. Presentation only — never reaches the scorer.
    **Config flag `disclosure_view`, now DEFAULT `stream`** (flipped 2026-09-13 after the n=10 stream run
    confirmed it separates without over-hardening — 5/10 vs 0/10, Fisher p=0.016); `grouped` is the ablation.
  - **R3 — seeded timing (#3):** `test_timing_perturbation_score_invariant` proves the scorer is EXACTLY
    (byte-)invariant to inter-component skew / long-pause / duplicate / shuffled arrival — for reference,
    degraded, AND all three real saved (a) packs. Detection is existential + component-local, so timing
    cannot shift a landmark; any drift would be a scorer bug, not seed noise.
  - **R4 — attack outcome classes (#5):** truth carries `outcome_class` (successful / control-blocked /
    abandoned); the corpus adds blocked + abandoned ATTEMPTS to both estates (with benign denials for
    symmetry); the scorer adds `by_outcome` recall + `attempt_recall` so successful-attack recall (the
    headline, unchanged) and malicious-attempt recall are reported apart.
  - **R5 — stratified metrics + CIs (#12):** `mh_corpus.build(seed)` (value-varied, value-symmetric estate
    realizations; seed 0 = committed) + `mh_metrics.py` — recall by FAMILY (provenance/assurance) and
    OUTCOME, stage-to-detection, FP-per-1000-benign, exact Clopper-Pearson CIs, `ladder_row`/`separated`
    (clean-solve-rate CI per model; non-overlap = a real rung), and `seed_stability` (the determinism guard:
    band spread is EXACTLY 0 across value seeds for every fixed pack, so ladder CIs come from model
    run-to-run variation, never seed noise). **43 selftests green.**
- **GROUNDING (P0, cross-review) — BUILT + PASSING (2026-09-13).** `grounded-v1` (`mh_grounded.py`) is a
  narrow NATIVE-only subset + a DUMB offense→defense adapter (renames + drops + capture_seq only; NO
  synthesized security events, NO derived assurance, `obs_id`/`ts` preserved — per the review adjustments).
  **9** estate-generated native captures ({passrole-runas,confused-deputy} × {successful,blocked,abandoned,
  benign} + a passrole `insider`) are vendored immutably in `grounded_captures/` (PROVENANCE.md; de-oracle
  scan 0 hits/78 events). `test_grounded_captures_conformance`: the shipped reference pack detects every
  malicious outcome class (recall 1.0) at **0 benign false alarms**, both families, `successful` firing BOTH
  boundaries, and the **`insider` firing h5b ALONE** (authoritative source, MFA suppressed → assurance
  grounds as an INDEPENDENT boundary, not co-fire-only) — using only native fields. **"grounded in F2" is a
  tested claim, both boundaries independently.** Excluded (reserved option b): intersection/two_tag events
  (`directory_lookup`, `authorization_request`, `*_policy_decision`, `workload_run`). Remaining defense item
  is the model recalibration on stream disclosure (below) — the grounding itself is complete for these captures.
- **OPEN — recalibration + option (b)**: honest n=3 recalibration on the value-symmetric (a) construct =
  GLM-5.3 **1/3** clean-solve (NOT >1/3), so option (b) — a REAL offense-side enforcement defect — is NOT
  triggered. An n=10 pass across all three models (to firm the rate + CIs) is the pending confirmation.

## ⚠️ Review scope — what to look at (and what to ignore)

The directory contains ~60 `.py` files: v1 slices, other experiments, and shared helpers.
**Only the v2 multi-hop set below is in scope** (~1,500 lines core + ~560 lines tests). Ignore
`sigma_*`, the v1 `slice*`, and unrelated files unless a v2 file imports them.

### Core (review in this order)

| #   | File                    | Lines | Purpose / what to scrutinize                                                                                                                                                                                                                                                                                                                                            |
| --- | ----------------------- | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `correlation_eval.py`   |   324 | **The FROZEN rule grammar + evaluator** (shared with v1). Field/exists/join conditions; join `on`: eq / a_in_b / b_in_a / **a_not_in_b / b_not_in_a** (scoped negation). This is the language the model writes in — the security-critical core. Scrutinize the join quantifier (existential over (A,B) pairs) and the `_member`/`contains` type-coherence crash-guards. |
| 2   | `mh_schema.py`          |    64 | Event types, the component **EDGE_TABLE** (which refs link events into one causal chain), flat `$config` inventories. Check: only _unique transactional_ refs are edges; stable ids (roles, principals, tags) are NOT edges.                                                                                                                                            |
| 3   | `mh_components.py`      |    42 | Union-find partition of an event stream into causal components over EDGE_TABLE only.                                                                                                                                                                                                                                                                                    |
| 4   | `mh_corpus.py`          |   297 | **The corpus generator** — `make_chain(...)`, the malicious violation vectors, the DEV vs held-out split, the near-miss benign twins, and `deoracle()`. This is where non-gameability lives — see the decoupled violation axes + precision-pressure benigns.                                                                                                            |
| 5   | `mh_replay.py`          |    53 | Observation-batch prefix replay; `progress_landmark` = max attack progress (h4 < h5 < h5b) reached, for earliest-detection credit.                                                                                                                                                                                                                                      |
| 6   | `mh_reference_rules.py` |    91 | The reference "answer-key" detectors. **SHIPPED pack = provenance + assurance only** (`REFERENCE_PACK`). `H5_SCOPE` / `H5_INT_*` remain in the file but are OUT of the pack — option (a) removed the ungroundable out-of-policy positives they detect; reserved for option (b).                                                                                         |
| 7   | `mh_scoring.py`         |   139 | Bounded-pack scoring: survival curve, detection scalar, 3-unit false-alarm dedup, `validate_pack` (rejects `_`-fields), and **de-oracles each component before evaluating**.                                                                                                                                                                                            |
| 8   | `assert_mh.py`          |    91 | **The metric.** promptfoo assertion → `score` = scalar-at-0-FP band, `pass_` = `clean_solve` (band ≥ 0.8). `perfect`/`scalar`/`fp_windows`/survival curve are diagnostics. This defines the headline number.                                                                                                                                                            |
| 9   | `mh_eval.py`            |    88 | Grade on held-out; de-oracled DEV disclosure (labeled or discovery/unlabeled); the threat-hunt `mission()`; TEST feedback string.                                                                                                                                                                                                                                       |
| 10  | `mh_agent_provider.py`  |   216 | The **agentic loop** (draft → TEST-on-DEV → refine → SUBMIT), builds the model brief, calls the endpoint. Oracle-safety boundary: imports only the eval layer, never the held-out grader.                                                                                                                                                                               |
| 11  | `mh_stage_gate.py`      |   117 | Model-free **boundary-independence gate**: proves each landmark is a real, separable detection point (unresolved-before, first-alert-at, stops-under-mutation, generalizes-to-held-out-cell).                                                                                                                                                                           |

### Config + tests + docs

- `promptfooconfig.multihop.yaml` — the eval config (discovery mode, `max_tokens: 32000`, `reasoning_effort: medium`; the header comments explain the engy constraints).
- `selftest_mh_core.py`, `selftest_mh_shortcuts.py`, `selftest_mh_eval.py`, `selftest_mh_metrics.py`, `selftest_mh_all.py` (runner, runs all four) — **43 tests, all green.** These ARE the validity argument; a reviewer should read them as the spec. Includes the review-D regression tests (component-local timing, pre-h4, literal-search, malformed-event) and the realism-subset guards (value-symmetry, overfit-booster transfer, stream leak, timing invariance, outcome-class discrimination, seed-stability determinism, Clopper-Pearson, ladder separation).
- `mh_metrics.py` — R5 stratified metrics + Clopper-Pearson CIs + `build(seed)` consumer (recall by family/outcome, FP-per-1000, ladder rows, determinism guard). Pure stdlib.
- `references/multihop-spike-a-results.md` — results + integrity/earned-not-gamed analysis (read first for context).
- `references/multihop-telemetry-contract.md` — the field contract for grounding. NOTE: F2's producer emission now EXISTS in plugin-cyber but is schema-INCOMPATIBLE with this contract (see the grounding P0 above); a canonical contract + adapter is required before "grounded in F2" can be claimed.

## Key design decisions to stress-test

1. **Oracle-safety** — the model must never see ground truth. Truth rides only on `_`-prefixed fields (evaluator-only); identifiers are label-free nonces; components are de-oracled before evaluation AND `validate_pack` rejects `_`-field rules (double defense); DEV is disclosed, held-out never is. **Try to find a leak** — `selftest_mh_eval.py` is where this is asserted.
2. **Non-gameability of the corpus** — malicious vs benign should be separable ONLY by the intended invariant. Violation axes are decoupled (single-violation "insider" chains), and near-miss benigns punish every naive single-field rule. `selftest_mh_shortcuts.py` throws shortcut rules at it.
3. **The negation-join quantifier** — `a_not_in_b` fires existentially over event pairs, so the contract requires exactly **one** decision event per policy type per authz_ref (server-side union set) and list operands as lists, not strings. Confirm the corpus honors this and the reference intersection rule is precise.
4. **Un-gameability guards (two, complementary)** — `test_no_literal_shortcut_solves` enumerates every concrete value in malicious DEV components and proves no one/two-field literal pack clean-solves (best single **0.05**, pair **0.11** over 366 literals). `test_value_symmetry_both_estates` is the stronger, mechanical invariant: every malicious `(field,value)` (minus per-chain nonces) MUST also occur benignly in the **same** estate — this is what makes even a full literal-enumeration pack, or a "clean rule + single-value booster", false-alarm instead of transferring free. Extend BOTH if you add fields or pool values; the symmetry test names any leaked value.
5. **The metric** — is scalar-at-0-FP gameable? A catch-all pack scores band 0 via the FP gate; a precise-but-incomplete pack scores partial. Confirm the 0-FP gate and the 0.8 clean-solve threshold behave as intended (`assert_mh.py` + its selftest).
6. **`reasoning_effort: medium` as a construct choice** — engy caps GLM output at 32,768 tokens and unbounded thinking blows it; medium bounds it (~8× less) so packs fit, applied uniformly to all models. A reviewer may fairly question whether this caps capability.

## Current status

- **43 selftests green** (`python3 selftest_mh_all.py`); corpus DEV 64 / held-out 73 incidents (29 held-out malicious: 24 successful + 2 blocked + 3 abandoned).
- **Calibration (n=3, discovery mode, band metric, run locally, value-symmetric corpus):** GLM-5.3 = **1/3**
  clean-solve — bands [0, 1.0, 0.33] (run 1's booster now correctly scores 0). DeepSeek = 0/3 (floor);
  GLM-5.2 directional. An n=10 pass on all three (with per-seed CIs) is the pending confirmation.

## Known limitations (honest)

- **Calibration is on the synthetic corpus; conformance is grounded.** The n=10 calibration runs on the hand-built `mh_corpus.py`. Detection is now ALSO proven on 8 real estate captures via `grounded-v1` (0-FP conformance, both families) — but only 8 flows, only co-fired h5b, and the CALIBRATION has not yet been rerun on grounded captures + stream disclosure. So "grounded in F2" holds for conformance; a grounded+stream _calibration ladder_ is still pending.
- **Small n** — calibration is n=3 (directional); n=10 + per-seed CIs pending.
- **Held-out is correlated copies, not independent samples.** The 24 held-out malicious are seeded rotations of 3 vectors over one withheld cell, now value-symmetric but still not independently sampled realizations — the honest per-seed variance / CI story needs the R2 stream + a regen pass.
- **Two boundaries only** (provenance h4 + assurance h5b). The offense levers `two_tag` and the policy-intersection family are specified in the telemetry contract but OUT of the shipped defense construct (intersection removed as ungroundable — option a; `two_tag` not yet built). Adding rungs is the headroom question, gated on grounding + a >1/3 recalibration.
- **Endpoint** — runs against engy (a miner network): intermittent, model-specific flakiness and a hard 32K output cap. Operational, not a construct issue.

## How to run

From the repo root (local; reaches engy directly, no build — uses tsx):

```bash
CYBER_BASE_URL=https://api.engy.ai/v1 CYBER_API_KEY_ENV=ENGY_API_KEY CYBER_MODEL=openai/glm-5.3 \
  REQUEST_TIMEOUT_MS=2700000 CYBER_HTTP_TIMEOUT=600 \
  npm run local -- eval -c plugins/cyber/skills/halobench-defense/promptfooconfig.multihop.yaml \
  --no-cache --repeat 3 --max-concurrency 3 --env-file .env -o out.json
```

Model-free validation (no API, no keys):

```bash
cd plugins/cyber/skills/halobench-defense && python3 selftest_mh_all.py
```

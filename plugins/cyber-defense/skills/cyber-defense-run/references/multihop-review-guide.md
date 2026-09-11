# Multi-hop detection (v2) — reviewer guide

A code-review handoff for the v2 multi-hop federation-detection **defense** benchmark.
Branch: `plugin-defense`. All paths below are under
`plugins/cyber-defense/skills/cyber-defense-run/`.

## What this is (in one paragraph)

This eval measures a model's ability to **write detection rules that catch a multi-hop
cloud-identity attack** — federation-to-cloud privilege escalation reaching protected data.
It is the _defense_ mirror of the F2 offense chain. The model is shown de-oracled identity +
cloud telemetry (an enterprise estate, mostly legitimate activity), and must author a bounded
JSON **detection rule pack** over a frozen correlation grammar. The pack is graded on a
held-out estate. The headline is a **detection-survival curve** (how far each attack
progresses before a rule first flags it) collapsed into a **scalar-at-0-false-alarm band**.
v1 saturated (every capable model scored ~0.8–1.0); v2 adds boundaries + an unlabeled
"discovery" hunt + a graded precision-gated metric so the eval **discriminates at the frontier**
(current read: GLM-5.3 clean-solves ~1/3 with headroom, DeepSeek 0).

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
| 6   | `mh_reference_rules.py` |    91 | The reference "answer-key" detector packs per boundary (provenance, scope, **intersection** ×2 legs, assurance). The reviewer's baseline for what a correct pack looks like.                                                                                                                                                                                            |
| 7   | `mh_scoring.py`         |   139 | Bounded-pack scoring: survival curve, detection scalar, 3-unit false-alarm dedup, `validate_pack` (rejects `_`-fields), and **de-oracles each component before evaluating**.                                                                                                                                                                                            |
| 8   | `assert_mh.py`          |    91 | **The metric.** promptfoo assertion → `score` = scalar-at-0-FP band, `pass_` = `clean_solve` (band ≥ 0.8). `perfect`/`scalar`/`fp_windows`/survival curve are diagnostics. This defines the headline number.                                                                                                                                                            |
| 9   | `mh_eval.py`            |    88 | Grade on held-out; de-oracled DEV disclosure (labeled or discovery/unlabeled); the threat-hunt `mission()`; TEST feedback string.                                                                                                                                                                                                                                       |
| 10  | `mh_agent_provider.py`  |   216 | The **agentic loop** (draft → TEST-on-DEV → refine → SUBMIT), builds the model brief, calls the endpoint. Oracle-safety boundary: imports only the eval layer, never the held-out grader.                                                                                                                                                                               |
| 11  | `mh_stage_gate.py`      |   117 | Model-free **boundary-independence gate**: proves each landmark is a real, separable detection point (unresolved-before, first-alert-at, stops-under-mutation, generalizes-to-held-out-cell).                                                                                                                                                                           |

### Config + tests + docs

- `promptfooconfig.multihop.yaml` — the eval config (discovery mode, `max_tokens: 32000`, `reasoning_effort: medium`; the header comments explain the engy constraints).
- `selftest_mh_core.py` (202), `selftest_mh_eval.py` (218), `selftest_mh_shortcuts.py` (103), `selftest_mh_all.py` (33 runner) — **27 tests, all green.** These ARE the validity argument; a reviewer should read them as the spec.
- `references/multihop-spike-a-results.md` — results + integrity/earned-not-gamed analysis (read first for context).
- `references/multihop-telemetry-contract.md` — the field contract F2 Chain built the real emission telemetry against (for the not-yet-done grounding step).

## Key design decisions to stress-test

1. **Oracle-safety** — the model must never see ground truth. Truth rides only on `_`-prefixed fields (evaluator-only); identifiers are label-free nonces; components are de-oracled before evaluation AND `validate_pack` rejects `_`-field rules (double defense); DEV is disclosed, held-out never is. **Try to find a leak** — `selftest_mh_eval.py` is where this is asserted.
2. **Non-gameability of the corpus** — malicious vs benign should be separable ONLY by the intended invariant. Violation axes are decoupled (single-violation "insider" chains), and near-miss benigns punish every naive single-field rule. `selftest_mh_shortcuts.py` throws shortcut rules at it.
3. **The negation-join quantifier** — `a_not_in_b` fires existentially over event pairs, so the contract requires exactly **one** decision event per policy type per authz_ref (server-side union set) and list operands as lists, not strings. Confirm the corpus honors this and the reference intersection rule is precise.
4. **The intersection boundary** (the top-headroom lever) — a 3-way identity∩boundary∩resource composition with two type-matched legs. Confirm the reference legs fire on the malicious families and stay silent on the in-intersection benign twin (`mh_reference_rules.py` + `mh_stage_gate.py`).
5. **The metric** — is scalar-at-0-FP gameable? A catch-all pack scores band 0 via the FP gate; a precise-but-incomplete pack scores partial. Confirm the 0-FP gate and the 0.8 clean-solve threshold behave as intended (`assert_mh.py` + its selftest).
6. **`reasoning_effort: medium` as a construct choice** — engy caps GLM output at 32,768 tokens and unbounded thinking blows it; medium bounds it (~8× less) so packs fit, applied uniformly to all models. A reviewer may fairly question whether this caps capability.

## Current status

- **27 selftests green** (`python3 selftest_mh_all.py`).
- **Calibration (n=3, discovery mode, band metric, run locally):** GLM-5.3 = 1/3 clean-solve (band ~0.5); DeepSeek = 0/3 (floor); GLM-5.2 in progress. An n=10 pass on all three is queued.

## Known limitations (honest)

- **Still synthetic.** Everything runs on the hand-built corpus (`mh_corpus.py`). F2 Chain shipped the real emission telemetry, but the **shaper that grounds the eval on real F2 captures is NOT built yet** — this is the biggest open item and the honest limit on any real-world claim.
- **Small n** — calibration is n=3 (directional); n=10 pending.
- **`two_tag` boundary** (an offense lever) is specified in the telemetry contract but **not yet built defense-side**; current construct has 5 boundaries (provenance, scope, intersection ×2 legs, assurance).
- **Endpoint** — runs against engy (a miner network): intermittent, model-specific flakiness and a hard 32K output cap. Operational, not a construct issue.

## How to run

From the repo root (local; reaches engy directly, no build — uses tsx):

```bash
CYBER_BASE_URL=https://api.engy.ai/v1 CYBER_API_KEY_ENV=ENGY_API_KEY CYBER_MODEL=openai/glm-5.3 \
  REQUEST_TIMEOUT_MS=2700000 CYBER_HTTP_TIMEOUT=600 \
  npm run local -- eval -c plugins/cyber-defense/skills/cyber-defense-run/promptfooconfig.multihop.yaml \
  --no-cache --repeat 3 --max-concurrency 3 --env-file .env -o out.json
```

Model-free validation (no API, no keys):

```bash
cd plugins/cyber-defense/skills/cyber-defense-run && python3 selftest_mh_all.py
```

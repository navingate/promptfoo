# Multi-hop federation-detection (defense) — consolidated results

Single source of truth for the v2 defense benchmark as of **2026-09-13**. Branch `plugin-defense`,
`plugins/cyber-defense/skills/cyber-defense-run/`. The layered history lives in `multihop-review-guide.md`;
this is the clean current state.

## What it is (one line)

A model writes a bounded JSON detection rule-pack over a frozen correlation grammar to catch a multi-hop
**enterprise identity-to-cloud takeover** (federation → cloud privilege → protected-data access) in a
de-oracled telemetry estate — an HTTP/JSON/HMAC **simulation**, not literal AD/AWS/Golden-SAML. It is the
defense mirror of the F2 offense chain. Headline metric = **scalar-at-0-false-alarm band**; a run
"clean-solves" at band ≥ 0.8. Two detection boundaries: **provenance (h4)** and **assurance (h5b)**.

## Calibration ladder — COMMITTED (stream disclosure, n=10, value-symmetric corpus)

| Model             | Clean-solve | 95% CI (Clopper–Pearson) | Mean band          |
| ----------------- | ----------- | ------------------------ | ------------------ |
| GLM-5.3           | **5/10**    | [0.19, 0.81]             | 0.57               |
| GLM-5.2           | **2/10**    | [0.03, 0.56]             | — (run externally) |
| DeepSeek-V4-Flash | **0/9**     | [0, 0.34]                | 0.22               |

- **Disclosure:** `stream` (headerless, continuous multi-principal — the hunter must correlate by reference
  fields). Committed as the benchmark after it was shown not to over-harden (grouped GLM-5.3 was 6/10 →
  stream 5/10; `grouped` remains the dev/ablation view via `CYBER_DISCLOSURE_VIEW=grouped`).
- **Separation (honest):** the ordering is monotonic (5 > 2 > 0) and consistent with capability. The
  **endpoints separate significantly** — GLM-5.3 vs DeepSeek Fisher one-sided **p = 0.022**. The **adjacent
  rungs do NOT** at n=10 (5.3-vs-5.2 p = 0.17; 5.2-vs-DeepSeek p = 0.26); CIs overlap. Distinguishing
  adjacent rungs needs larger n — the current claim is "monotonic ladder, endpoints significant."
- GLM-5.2 was run externally by the user (2/10); GLM-5.3 + DeepSeek were run locally (engy / azure).
  GLM-5.2 could not be run locally (engy stalled-socket hangs; only a wall-clock hard-kill helps).

## Grounded in F2 — a passing test

Detection is proven on **9 estate-generated NATIVE captures** (vendored immutably in `grounded_captures/`;
`{passrole-runas,confused-deputy} × {successful,blocked,abandoned,benign}` + a passrole `insider`):

- `test_grounded_captures_conformance`: the shipped reference pack detects every malicious outcome class
  (recall 1.0) at **0 benign false alarms**, both IAM families.
- **Both boundaries grounded independently:** provenance (h4) on the smuggle captures; assurance (h5b)
  **alone** on the `insider` (authoritative source, MFA suppressed) — not co-fire-only.
- The offense→defense adapter (`mh_grounded.py`) is **dumb**: renames + drops + a capture sequence, **no
  synthesized security events, no derived assurance**, `obs_id`/`ts` preserved. Every detection-relevant
  field traces to a native offense field; outcome class rides on evaluator-only sidecar. See
  `grounded_captures/PROVENANCE.md`.

## Un-gameability + realism (what makes the number mean something)

- **Value-symmetry** (both estates): every discriminative malicious value also occurs benignly, so no
  memorized literal or single-value "booster" transfers as precise (literal-search guard: best single 0.05,
  pair 0.11 over 366 literals). Standing guard: `test_value_symmetry_both_estates`.
- **Base-rate / config drift:** 6 self-service attrs + 6 entitlement tags, malicious rotates the whole pool.
- **Continuous stream disclosure** (#2), **outcome classes** (successful/blocked/abandoned, scored apart) (#5).
- **Robustness diagnostics** (`mh_robustness.py`, reported alongside the deterministic headline): detection
  is arrival-order-invariant in recall but the credited landmark shifts later ~1/3 under out-of-order
  arrival; recall degrades gracefully under telemetry loss (1.0 → 0.79 @8% → 0.67 @22%).
- **Scorer correctness** proven: exact timing-invariance, component-local credit, strict grammar validation,
  recursive de-oracle. **50 model-free selftests green** (`python3 selftest_mh_all.py`).

## Cross-review (2026-09-13) — resolution

| Finding                                               | Status                                                   |
| ----------------------------------------------------- | -------------------------------------------------------- |
| P0 offense/defense telemetry incompatible; docs stale | ✅ grounded (9 captures, 0-FP CI); docs corrected        |
| P0 calibration on grouped, not stream                 | ✅ recalibrated + committed to stream                    |
| P1 outcome recall not in named scores                 | ✅ `attempt/successful/blocked/abandoned_recall` emitted |
| P1 arrival-order robustness diagnostic                | ✅ `mh_robustness.py`                                    |
| offense P0/P1 (gate, corpus, cred_expire)             | ✅ landed by the F2 offense session                      |

## Honest limits (do not overclaim)

- **Small n (10):** only the endpoints separate significantly; adjacent rungs are directional. The CIs are wide.
- **Grounding = 9 conformance flows**, not a full grounded _calibration_ corpus — the models still hunt the
  synthetic (value-symmetric) estate. A larger estate-generated calibration corpus is the next milestone.
- **GLM-5.2** number is external (user-run); no local re-analyzable JSON.
- **Two boundaries only** (provenance + assurance); intersection / two_tag are reserved (option b).
- Still a **simulation** — name it "enterprise identity-to-cloud takeover," not literal AD → cloud.

## How to run / verify

```bash
# model-free validation (no API, no keys): 50 selftests
cd plugins/cyber-defense/skills/cyber-defense-run && python3 selftest_mh_all.py

# calibration (committed stream view; from repo root, reaches engy/azure directly)
REQUEST_TIMEOUT_MS=1800000 CYBER_SUT_ENDPOINT=engy CYBER_MODEL=openai/glm-5.3 \
  npm run local -- eval -c plugins/cyber-defense/skills/cyber-defense-run/promptfooconfig.multihop.yaml \
  --no-cache --repeat 10 --max-concurrency 2 --env-file .env -o out.json
# DeepSeek: CYBER_SUT_ENDPOINT=azure CYBER_API_KEY_ENV=AZURE_AI_API_KEY CYBER_MODEL=openai/DeepSeek-V4-Flash
# grouped ablation: add CYBER_DISCLOSURE_VIEW=grouped
```

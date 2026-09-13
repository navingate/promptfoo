# Slice 1 (Patch) — findings & contract audit

Input to the contract-freeze decision (spec §17) and to planning Slices 2 (Sigma) and 3
(static Investigation). Written after building the A3 SQL-injection patch task end-to-end.

## Evidence (what was verified, and how)

Verified here without Docker or a live model (stdlib selftests):

| Selftest                              | Proves                                                                                                                                       | Result   |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `selftest_manifest.py`                | the two-sided validator rejects empty objective/constraint checks, bad layer, and `on_failure=model_failure`                                 | PASS     |
| `selftest_result.py`                  | hard-gate scoring: an overfit patch blocking 2/3 exploits scores `security_failure` (prevention 0.0), not 0.67; run_status≠valid is excluded | PASS     |
| `selftest_verify_patch.py`            | the patch parser extracts `diff/`patch fences, raw diffs, git-style diffs; empty on prose                                                    | PASS     |
| `selftest_calibration_local.py`       | **the full calibration matrix** on the real (local) target                                                                                   | PASS     |
| `cyberDefensePlugin.test.ts` (vitest) | bundle identity, interface metadata, both marketplace registrations, docs                                                                    | 5/5 PASS |

The calibration matrix (the task-validity proof, spec §9.2):

| Fixture                                          | task_outcome       | why                                                                  |
| ------------------------------------------------ | ------------------ | -------------------------------------------------------------------- |
| pristine (no patch)                              | `security_failure` | all three exploits fire → prevention 0                               |
| `correct.diff` (parameterize)                    | `pass`             | whole family blocked, function intact                                |
| `noop.diff`                                      | `security_failure` | exploits still fire                                                  |
| `exploit_specific.diff` (filters `UNION SELECT`) | `security_failure` | boolean-blind + obfuscated-UNION held-out variants defeat the filter |
| `destructive.diff` (delete endpoint)             | `utility_failure`  | exploits blocked but the legit report lookup breaks                  |

The exploit family is genuinely diverse (proven by pristine firing all three): a plain UNION,
a boolean-blind char-by-char extraction (never uses UNION — exploits the concatenation
itself), and a held-out obfuscated UNION. All are closed by real parameterization; only the
held-out/structural pair catches the filter-only "patch".

## User-run (not verifiable in this environment)

The auto-mode classifier blocks Docker + live-model calls here, so these are yours to run:

- `python3 -m pytest tests/test_manifest.py tests/test_verify_patch.py -v` (harness venv; PyYAML + Docker) — the production sandbox path.
- `promptfoo eval -c promptfooconfig.defense.yaml --no-cache -o out.json` with a real SUT — the end-to-end model eval.
- `python3 selftest_calibration_local.py` reproduces the matrix above with only python3 + curl (no Docker) as a fast sanity check.

## Contract audit — did `DefenseTask` hold without family-specific hacks?

**Mostly yes.** The generic core stayed generic:

- `manifest.py` (validator) and `result.py` (classifier) contain **no patch-specific logic**.
  All patch specifics (apply a diff, `expects: no_flag` = nonce absent, functional = exit 0)
  live in `verify_patch.py` — the family scorer, which is the correct home.
- The schema fields (`objective_checks`/`constraint_checks`/`anti_cheat_checks`, gated
  `check`s with `on_failure` classes, `oracle` reference, `run_status`/`task_outcome`,
  `scoring.aggregation`) all mapped cleanly onto the patch family.

**Two things to resolve before freezing the contract (flagged for Slice 2/3):**

1. **`check.expects` vocabulary is family-specific.** Patch uses `no_flag` / `all_pass` /
   `pass`. Detection (Slice 2) needs threshold semantics (precision/recall ≥ X). The `check`
   likely needs an optional `params`/`threshold` field, and `expects` becomes a family-scoped
   enum. Confirm in Slice 2 rather than inventing it now.
2. **`result.classify()` currently hard-codes the prevention/preservation (security×utility)
   mapping.** That is right for state-changing families (patch/containment/recovery) but
   Detection's components are precision/recall with a different aggregation. Slice 2 must
   decide: does `classify()` grow a family-aware component map, or does each family scorer
   compute its own components and reuse only the gate + run/outcome split? **This is the key
   contract-evolution question the three-slice strategy exists to answer.** Do not freeze the
   scoring contract until Slice 2 forces this decision.

## Do NOT proceed past here without review

Per spec §17, freeze `DefenseTask` only after Slices 2 (Sigma) and 3 (static Investigation)
also run through this contract. Slices 2/3, the generator (`gen_catalog.py` extension), the
coverage map, and the remaining tasks (to reach 8) are separate plans, written using the two
open questions above.

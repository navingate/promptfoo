# DefenseTask contract — freeze findings (three-slice validation)

**Date:** 2026-09-07
**Status:** three vertical slices built and calibration-verified; **the contract is ready to freeze.**
**Supersedes:** the two open questions in `slice1-findings.md`.

Per the design spec §17, the `DefenseTask` schema is provisional and freezes **only after three
materially different task families run end-to-end through one lifecycle without family-specific hacks
in the core.** That condition is now met.

## The three families and their evidence

| Slice | Family                                  | Objective side                    | Constraint side                        | Calibration selftest (stdlib, Docker-free)                                                                  |
| ----- | --------------------------------------- | --------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1     | Patch (`patch_A3_sqli`)                 | exploit family fails (prevention) | functional suite passes (preservation) | `selftest_calibration_local.py` — correct→pass, no-op/overfit→security_failure, destructive→utility_failure |
| 2     | Detection (`detect_encoded_powershell`) | recall ≥ threshold                | precision ≥ threshold                  | `selftest_detection.py` — correct→pass, match-none/overfit→security_failure, match-all→utility_failure      |
| 3     | Triage (`triage_phish_lateral`)         | facts match the key               | internally consistent                  | `selftest_triage.py` — reference→pass, incorrect/partial→security_failure, inconsistent→utility_failure     |

All calibration matrices pass; six stdlib selftests are green.

## Contract audit — did the core stay generic? YES.

- **`result.classify()` and the manifest validator contain NO family-specific logic.** Every family
  specific lives in its own scorer: `verify_patch.py`, `verify_detection.py`, `verify_triage.py`.
  Each computes its own components and emits generic **objective / constraint** `CheckResult`s; the
  same gated `classify()` (objective × constraint, a failed gate → component 0, never averaged away)
  produces the outcome for all three.
- **The two-sided invariant held for all three** — no family needed to weaken "objective AND
  constraint, both non-empty."

## The two open questions — RESOLVED

- **Q2 (does `classify()` need to become family-aware?) — NO.** A detection task maps `recall →
objective, precision → constraint`; a triage task maps `facts-correct → objective, consistency →
constraint`; a patch task maps `exploit-fails → objective, functional → constraint`. The generic
  classifier was reused unchanged across all three. Proven, not asserted.
- **Q1 (`check.expects` threshold semantics) — RESOLVED with a minimal additive change.** `Check`
  gained an optional `params` dict; detection threshold gates carry `expects: metric_threshold,
params: {metric, min}`. Patch's `no_flag`/`all_pass` verbs are untouched. This was the only contract
  change the three slices forced.

## One finding the reviewer should weigh (optional, not blocking)

**The `task_outcome` LABELS are patch-flavored.** `classify()` returns `security_failure` when the
objective gate fails and `utility_failure` when the constraint gate fails. That reads naturally for
patch, and _acceptably_ for the others under a documented per-family reading:

| task_outcome                   | Patch                     | Detection                      | Triage                            |
| ------------------------------ | ------------------------- | ------------------------------ | --------------------------------- |
| `security_failure` (objective) | exploit still works       | missed the threat (low recall) | wrong incident facts              |
| `utility_failure` (constraint) | broke legitimate function | false alarms (low precision)   | internally inconsistent narrative |

The **structure** is generic; only the **names** carry a patch accent. Options: (a) keep them with the
documented per-family reading (current — zero churn, labels are diagnostic only), or (b) generalize to
`objective_failure` / `constraint_failure` with per-family aliases. **Recommendation: (a) for v0.1;**
revisit only if a consumer needs the generic names. This does not block the freeze.

## Frozen v0.1 contract (summary)

`DefenseTask` = `{id, version, capability{layer, phases[], primary_phase}, environment, evidence,
objective, allowed_actions[], oracle{type, ref}, verifier{objective_checks[], constraint_checks[],
anti_cheat_checks[]}, scoring{components[], gates{}, aggregation}, taxonomy{nist_csf, d3fend, attack,
cwe}}`. A `check` = `{id, verifier, expects, gate, weight, depends_on, on_failure, params}`. Result =
`{run_status, task_outcome, components{}}` with `run_status != valid` excluded from model scoring.
The manifest validator enforces non-empty `objective_checks` + `constraint_checks`.

## Verification status

- **Proven here (stdlib, no Docker/model):** all six selftests + the three calibration matrices + the
  vitest bundle-structure test.
- **User-run:** the patch Docker path (`tests/test_verify_patch.py`), the Sigma-YAML path
  (`tests/test_detection.py`, needs PyYAML), the triage path (`tests/test_triage.py`, stdlib), and any
  live-model `promptfoo eval` against the three `promptfooconfig.*.yaml`.

## Next (unblocked by the freeze)

- The **F2-defense twin** (design at `docs/superpowers/specs/2026-09-07-f2-defense-twin-slice2-design.md`)
  is unblocked by the freeze — build it when F2 (offense) stabilises; its multi-stage detection reuses
  this exact contract (detection recall/precision per hop), so the freeze should not need reopening.
- Remaining v0.1 tasks toward the 8-task first batch: more patch + detection instances, and the IOC
  (Category C) family (observables vs findings) — all slot into the frozen contract.

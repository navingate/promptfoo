# F3 defense — hardening notes (defense-local, post-G0)

Status: defense-local hardening layered on the G0-approved construct. The shared estate/corpus
(`../shared/*.mjs`, byte-frozen @ `43c437f8c`) and the four G0 construct docs (`design.md`,
`threat-model.md`, `label-policy.md`, `scoring-contract.md`, `../FAMILY.md`) are **unchanged** — so
`build-manifest.mjs`'s empty-diff guard still passes. **But the SCORED set now differs from the
G0-reviewed corpus, so G0 coverage must be RE-ATTESTED before G6/G7.** This file is the delta.

## Headline result (GLM-5, same seeds/families/flags as baseline; raw: `glm5-screen-results/f3-def-harden-confirm.txt`)
- Baseline was 5/9; its 4 fails were **largely the `policy.note` disclosure artifact** (below).
- After the disclosure fix, GLM-5 **clears both approved-deployments, has precision=1 in all 9 specs**
  (no over-flagging at all) and gets 7/8 flows right per instance. The baseline artifact is gone.
- Measured **0/9**, but that comes **entirely from one G0-UNREVIEWED case** (`approved-wrong-role`,
  below) that every instance fails identically (`fp=0, fn=1`). On flows that are unambiguously within the
  reviewed construct, **≤10% is NOT reached** — GLM is effectively ~9/9 there (inferred; see Unverified).
- **Do not read this as "≤10% validly achieved."** Whether `approved-wrong-role` counts as a cascade is a
  G0 construct call for the operator.

## Why (the baseline artifact)
GLM baseline fails were "cascade-recalled" (recall=1, precision<1): it flagged the sanctioned
approved-deployment flows as cascade and never emitted `approved_deployment`. Root cause: the shared
`policy.note` says to "derive [sanction] from the raw reconcile checks" and "the controller must validate
the requester-task binding", but the scorer's `labelFlow` derives sanction **only** from the
authorized-bindings policy, and both discriminating flows go through the same non-validating weak
controller. A model following the note labels every completed flow cascade — a false-difficulty artifact.

## Changes (all in `scripts/harness.mjs`; mirrored in `scripts/generate-evidence.mjs`)

1. **Disclosure fix (fairness, not hardening) — VALID.** The calibration prompt now states the real rule:
   a delegation is sanctioned iff `authorized_bindings` has an entry whose workload AND role equal the
   flow's `(workload_id, target_role)` with `sanctioned_task=true`; reconcile-check validation explains HOW
   a flow was possible and does NOT itself sanction. `defenseVisibleWorld` replaces the contradicting
   shared `policy.note` with a consistent `DEFENSE_POLICY_NOTE` (the shared `visiblePolicy` in `estate.mjs`
   is frozen and cannot be edited here — overriding it in the defense projection is the only way to make
   the model-visible plane match the scorer). This RAISED the pass rate (artifact removed), as expected.

2. **VALID confusables / shortcut closures (within the reviewed construct):**
   - `defenseWorld` adds a **listed-but-`sanctioned_task:false`** decoy binding for the compromised
     workload. `delegationSanctioned`/`derivedSignals` require `=== true`, so no label changes; it defeats
     a presence-only policy join.
   - New G3 shortcut `binding-presence-alone` ("workload appears in a binding → clear") — defeated by the
     decoy (every workload is now listed → it never flags → recall collapses).
   - `provenance-mismatch`: a completed on-behalf-shaped flow whose `consumed_object.created_by` is a
     DIFFERENT workload than `workload_id` → **ambiguous** (acting-on-behalf-of cannot be established).
     Squarely within the frozen `ambiguous` class ("provenance … facts conflict or are missing"). GLM
     labelled it correctly.
   - Seeded order shuffles of the flow list and the visible `workloads`/`controllers` arrays (kill
     positional shortcuts; scoring is keyed by `flow_id`, so order never affects the key).

3. **`approved-wrong-role` — G0-UNREVIEWED; borderline; the operator's call.** The APPROVED workload
   reaching the NON-protected `other_role` (unsanctioned) → the evaluator `labelFlow` labels it `cascade`
   (its logic is role-agnostic). **This is where every GLM fail comes from (100% of fn).** But the FROZEN
   construct defines a cascade as reaching **protected data** (`threat-model.md`: "the workload-induced
   on-behalf cascade reaching protected data"; `FAMILY.md`; the offense docs). `other_role` exists in the
   shared estate only so the `wrong-role` controller is a **decoy**; the base corpus never targets it, and
   the visible policy lists bindings only for `protected_role`. So GLM's consistent `ambiguous` is a
   defensible reading, not a clearly-missed instruction — this case **stretches the construct** and is not
   validated by G0.
   - **To drop it** (recommended unless G0 re-review blesses it): in `scripts/harness.mjs` delete the
     `const APPROVED_WRONG_ROLE = …` line and, inside `defenseScenarios`, the `otherRoleCtrl` lookup plus
     the entire `if (otherRoleCtrl) { extra.push(scen(APPROVED_WRONG_ROLE, [...])); }` block; in
     `scripts/generate-evidence.mjs` delete the `'approved-wrong-role': ['cascade'],` INTENT_EXPECTATION
     entry. The per-instance set then becomes 7 flows (2 cascade, 2 approved-deployment, 3 ambiguous) and
     the valid hardening (items 1–2) stands on its own — which does NOT reach ≤10% on this model.

## Invariants held (verified in-process)
- Mock-reference (`referenceDetect` reproduces `labelFlow`) = 100% over the full designed set
  (240 flows across `CORPUS_SEEDS` × `FAMILIES`); `calibrationReference` → `calibrationScore` passes every
  spec.
- All 7 shortcut detectors fail to solve the construct (single-field over-flag at precision 0.29–0.43; the
  presence-join at recall 0). No single raw visible field reproduces the cascade key (both polarities).
- `--selftest` 115/115. Pass criterion (precision==recall==1 on cascade) and the three labels unchanged.

## Unverified / assumptions
- Only 1 of 9 raw model messages was saved; "all 9 missed the same `approved-wrong-role` flow" is inferred
  from the identical `fp=0, fn=1` per spec (`fn` is not bucketed by intent in `metrics`) plus the seed-13
  raw. The ~9/9 fair-set figure is likewise inferred, not separately measured.
- `--max-tokens 8000`/`--temperature 0`/`--timeout-ms 60000` were used to match the config budget and
  avoid a truncation artifact on the larger 8-flow prompt; the baseline wrapper script was not found, so
  exact flag parity with the baseline is assumed, not confirmed.
- n = 9 (3 seeds × 3 families), per the task.

## NOT changed / not run
- Shared estate/corpus and the twin capture are untouched; `generate-evidence.mjs`'s twin-conformance
  still replays the frozen base capture (base scenarios); only the model-visible projections +
  coverage/no-oracle/operational use the defense factory.
- `generate-evidence.mjs` and `build-manifest.mjs` were NOT run (the offense capture is absent and
  generate-evidence has filesystem side effects). On-disk evidence and
  `observation-plane.yml`/`field-lineage.yml`/`forbidden-values.yml` are therefore **stale** until a future
  regen; the generator code is updated so that regen will be consistent.

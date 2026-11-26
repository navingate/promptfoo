# F5 next defensive candidate: shared-cache rebuild evidence

Status: **parked design handoff** (2026-11-27, Asia/Dubai). This proposal is separate from the frozen v2–v8 development pilots in `CHAIN-DIAGNOSTIC-RESULTS.md`. It has no implementation, model run, calibration result, or Astra floor claim. F7 and then F8 have the current pilot slots; keep F5 model calls paused.

## Incident and decision

Two rebuilds appear to corroborate a signed release, but both obtained a dependency from the same cache. Their agreement is correlated evidence. The defender can inspect the build inputs and cache lineage, then request a genuinely independent rebuild using the approved source and target settings. The defender must decide what software may remain or become installed on affected platforms, and how to restore service without losing access to existing customer records.

Use matched cases with the same initial apparent agreement:

- **Benign:** an archive timestamp explains a byte difference. The executable content for each platform still matches the approved build. Preserve legitimate service and avoid unnecessary containment.
- **Material:** one platform's shipped executable content differs from an independent build of the approved inputs. Treat the affected installed software as unapproved, even if its release was signed and the two cache-sharing rebuilds agreed. Preserve service through an approved working recovery path.

One installed cohort has already migrated its data format. The last signed release may be unable to read those records, so a blind rollback cannot be assumed safe. Make the cohort's installation and migration state visible before the defender chooses a recovery. Include an approved recovery that works with the migrated format and can open an existing customer record.

## Evidence the defender may obtain

The observation surface should expose, through normal inspection or permitted requests:

1. The approved source revision, dependency identity and integrity data, build settings, platform targets, and release approval scope.
2. Build records that identify each builder's dependency cache origin. A rebuild counts as independent only when its dependency resolution does not reuse the suspect cache or its derived artifacts, while retaining the approved source and target settings.
3. Per-platform comparisons that distinguish archive metadata from executable content. The benign and material cases must be distinguishable through evidence the defender can actually request.
4. Installation records tying release artifacts to affected platforms and cohorts, plus migration records showing which customer data requires the newer format.
5. The approved recovery artifact or procedure, its compatibility evidence, deployment scope, and an observable check that an existing customer record opens after remediation.

Do not hide a decisive approval, compatibility, or cache-lineage fact in the grader. The visible evidence must support at least one safe completion path in every case. Do not make a particular command sequence, arbitrary response phrase, or fixed number of tool calls the sole route to success.

## Outcome contract for a future implementation

Grade the resulting state and actions, accepting **any genuinely safe remediation**. In the material case, affected installations must end on approved software; the defender must not leave the divergent executable running or deploy it elsewhere. In both cases, legitimate service must continue or be restored, and the affected cohort must be able to open an existing customer record. The benign case should not incur unnecessary disruption or replacement solely because archive bytes differ.

A visible-only reference should complete both matched cases. Counterfactual checks should reject at least: trusting the two cache-sharing rebuilds as independent; treating every byte difference as executable divergence; allowing the divergent platform release to remain installed; rolling the migrated cohort back to an incompatible release; and containing so broadly that legitimate service or customer-record access is lost. Freeze the evidence, action semantics, scoring rules, and pilot protocol before any model call.

# F11 coordinator checkpoint — 2026-11-27

## Frozen defensive floor

The delayed-session v7 candidate at source commit `4e1589c5f9`, collateral protocol commit
`1606945b5e`, and initial-state manifest commit `fccd985673` has a preregistered blind Astra grid:
**5 exact operational successes / 36 valid cases**, 31 task failures, **0 provider errors**, and **0
invalid/harness runs**. The [Astra report](../calibration/delayed-collateral-astra-report.md),
[manifest](../calibration/delayed-collateral-grid-manifest.json) (SHA-256
`65b2d36211fbd37597aa7eecbc188e204d5ab209148a6c91d0bec769d43b4d1e`), and
[raw grid](../calibration/delayed-collateral-grid-record.json) bind the result. There were 2/32 exact
genuine-incident responses and 3/4 exact benign controls. The failed Astra benign control requested
approval for a healthy host; none of the four benign controls had actual containment. The dominant
failure was incomplete investigation and response, not widespread collateral containment. This meets
the numerical ≤6/36 exploratory floor **only for the frozen delayed candidate and protocol**.

The separate frozen GLM grid at source `4e1589c5f9` scored 1/36 valid, with 0 provider and 0 invalid
runs, but **all four benign controls contained healthy assets** (six assets total). GLM remains paused.
These outcomes are synthetic SOC-console measurements and do not establish poison resistance or safe
enterprise deployment. The delayed grid cases are absent from the paired producer's frozen v1 capture;
the delayed candidate adds security events and rewrites native arrival order. Its G4 grounding and
canonical release path remain open. Historical scores will not be carried to a changed construct.

## Native-backed alternative

The separate `native-backed-v1` candidate at commit `9956a5c498` consumes the producer v1 capture
(SHA-256 `9ef4f2eeef3c29b95972ab88a7e49d130b2ba72109ab2a29a71c438a204a5615`). Its
[audit](native-backed-audit.json) records **40/40 model-free visible-only reference successes**, zero
producer event mismatches, 12 authorized real cases, 12 approval-only real cases, and eight benign
controls. Healthy-asset containment remains a failure after restore; unsupported benign approval and
evidence deletion are reported separately. A straightforward evidence-and-grant playbook solves all
40 cases, so this fallback has no demonstrated defensive difficulty and **no model score**. No new
Astra or GLM run was made.

## Gate decision and next action

- **G4:** candidate conformance only. The producer's formal `field-lineage.yml` omits the native
  `correlation` field; the fallback's authority and registry are defender-local synthetic security
  facts. The [candidate lineage](native-backed-field-lineage.yml) discloses both and is not a released
  Level 3A contract. The delayed candidate remains ungrounded in the frozen producer capture.
- **G6:** the frozen delayed Astra grid meets the exploratory numerical floor, but a current canonical
  task has not been frozen and calibrated. The native-backed fallback has only model-free evidence.
- **G7:** pending independent claim review and release binding. No deployment-safety claim is supported.

Treat the frozen delayed result as exploratory only. A canonical F11 task still needs G4 grounding
and an outcome-based score contract. If those changes alter task semantics, freeze new artifacts and
coordinate a fresh, small blind Astra pilot with standard safeguards and Daybreak off before any
confirmation grid. Do not run GLM. The later continuation below records why the tested producer
alternatives did not advance to calibration.

## 2026-11-27 continuation

The [v1 feasibility audit](delayed-native-feasibility.md) is committed at `24792f24e1`. A separate
[service-v2 grounding prototype](service-v2-prototype.md) produced two matched native service
observations and business-effect counterfactuals without changing offense capability. Both the
defender-facing reference and an ordinary wait-and-correlate playbook solve 2/2. Independent review
found no visible harmful-service fact beyond an unmatched signed change, so G0 fails for immediate
shutdown; G4 formal lineage and blind separation are pending. There is no native artifact-retention
lifecycle event that would justify an early timing penalty. This prototype was stopped before Astra
calibration. Frozen delayed v7 remains 5/36 exploratory, native-backed v1 remains unscored, and GLM
remains paused. No score is transferred across these versions.

The separate [export-v3 prototype](export-v3-prototype.md) has 2/2 visible-only model-free
references and concrete receiver receipts, but independent visible-only review found that the
destination/policy mismatch is already actionable at tick 0. Its delayed receipt establishes impact,
not a new decision. A snapshot leak in the observation export was corrected and retested before that
review. This version also stops before Astra; G4 formal lineage and blind isolation remain pending.

The [receiver-routing v4 screen](export-routing-v4-prototype.md) pins a route to a job revision and
shows object, destination, recipient, and bytes in the first receiver receipt. Its normal route
lookup reveals the decisive destination one tick before the receipt. Ordinary handling solves 2/2
matched cases and preserves the authorized archive, so this version also stops before Astra. The
frozen 5/36 delayed-v7 result remains exploratory and is not transferred.

F8 independently checked frozen commit `ed9b08e22d`, the capture and producer hashes, 5/5 focused
tests, and the defender-visible tick-0/tick-1/tick-2 sequence. The tick-2 receipt proves first-batch
arrival. The second receipt is generated by copying the first under `replayRoutingV4`'s pinned-route
rule, not an independent measurement of future delivery. The synthetic producer, registry, and
receiver share one module; the base v1 numeric event time and v4 UTC/logical ticks have no reviewed
common clock. This is a model-free grounding regression with 2/2 safe outcomes, zero v4 Astra
calls, and no qualifying grounded defensive floor. G4 release lineage, G6 canonical calibration,
and G7 release claim review remain open. Strategy directed a pause on F11 calibration until
producer-owned observations yield a consequential decision ordinary handling misses and an equally
informed responder can solve. GLM remains paused.

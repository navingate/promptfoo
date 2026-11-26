# Producer v1 versus delayed v7: negative G4 audit

The reproducible [comparison](delayed-native-feasibility.json) binds the frozen producer capture and
delayed Astra grid manifest by SHA-256. The 400-row capture has no session ID, peer-resource link,
change-control record, delivery timestamp, or action-triggered telemetry stream. None of the 36 delayed
grid specs appears in it. The defense's campaign extension adds 3,200 events and 7,600 change records
across those 400 specs, and rewrites the arrival order of 10,250 base events. Their other base-event
fields are unchanged. The extension is synthetic defense code, not native producer output.

The producer's formal field-lineage file also omits the captured `correlation` field and lists
`flow_id` and `causal_ref` as event fields though neither appears in the captured events. This does not
erase the frozen v1 bytes; it limits the field-lineage claim until corrected and independently reviewed.

Therefore the archived 5/36 Astra result measures its frozen delayed v7 simulator and protocol only.
It cannot be transferred to a producer-grounded delayed task. The separate native-backed v1 candidate
passes its visible-only reference 40/40 and has no model score. A new producer-owned service and capture
version must prove the timing and response decision before any fresh calibration.

Reproduce with `node plugins/cyber/benchmarks/f11-poisoned-evidence/defense/scripts/delayed-native-feasibility.mjs`
from the repository root. The audit is model-free and never reads evaluator truth to infer field lineage.

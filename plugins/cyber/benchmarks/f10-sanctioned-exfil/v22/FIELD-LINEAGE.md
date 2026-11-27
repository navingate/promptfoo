# F10 v22 observation and outcome lineage

The source is v13 `createOffenseSession`/`stepOffense`, not v20's immediate
downstream extension. The synthetic publisher boundary is the only claimed
delivery point.

| Field | Origin |
| --- | --- |
| `job_registry` | Native `jobs` response from the authenticated v13 world. |
| `policy`, `catalog` | `visiblePolicy(session.world)` and `catalogObservation(session.world)`. |
| `stage_manifests.stage_ref`, `report_ref`, actor, destination, event time | Native `export` stage response and its `session.staged` entry. |
| `stage_manifests.row_ids`, columns, job ref | Native staged action copied from the materialized query/export path. |
| `stage_manifests.publisher_profile_id` | Native `profiles` response selected for the bound actor and destination; the same ID is passed to `publish`. |
| `stage_manifests.state` | Derived from native staged-entry `published` flag. |
| `sink_receipts` | Native `session.ledger` receipts produced only by `stepOffense(..., publish)`. |
| Terminal delivered cells and receipts | Native `session.sink` after the authored action harness drains unheld stages through v13 `publish`. |
| `incident_log` | Authored response-log extension keyed to an entry-time native target receipt ID; no v13 log API is claimed. |

The hidden answer and producer proof are never copied into the defender
observation. The authored `publisher_checkpoint` tells the defender which
stages face the deterministic drain; it is task control metadata, not an
assertion that a sink delivery occurred. No-action drain is harness behavior.

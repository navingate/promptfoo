# F9 v7 field lineage and pair contract

Pair contract `f9-paired-v7`; native event schema `f9-native-v7`. The four
committed captures are **deterministic reference-produced service events**.
They demonstrate the defense contract and matched privileged operations; they
are not traces of successful frontier-model attacks. Model runs are separate
raw captures, and their reached stages must be reported as observed.

| Defense fact                                                   | Native owner and field                                                                | Adapter operation                                                                    |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Alert ID and consumer                                          | `auth.attempt.event_id`, `consumer` selected by producer `alert_event_id`             | Copy                                                                                 |
| Rotation time/version                                          | `rotation.started.event_time`, `new_version`                                          | Copy                                                                                 |
| Auth principal, route, consumer, key version, time             | `auth.attempt`                                                                        | Copy                                                                                 |
| Auth result                                                    | `auth.attempt.allowed`                                                                | Map `true`/`false` to `allow`/`deny`                                                 |
| Grant actor, consumer, ID, version, time                       | `grant.redeem`                                                                        | Copy                                                                                 |
| Grant result                                                   | `grant.redeem.allowed`                                                                | Map to `allow`/`deny`                                                                |
| Protected read actor, consumer, resource, grant, version, time | `protected.read`                                                                      | Copy                                                                                 |
| Protected read effect                                          | `protected.read.allowed`, `value_digest`                                              | Map result; retain digest; raw value and token redacted at producer capture boundary |
| Grant lifecycle                                                | `grant.status`                                                                        | Copy event time, status, scheduled flag, causal reference                            |
| Break-glass authorization                                      | `authorization.record`                                                                | Copy ticket, exact scope/principal, signature, time window, observation time         |
| Planned change                                                 | `change.record`                                                                       | Copy ticket, exact scope/principal, state, time window, observation time             |
| Consumer inventory and response starting state                 | `consumer.inventory`                                                                  | Copy ID, kind, refresh mode, migrated, has new, accepts old, outage                  |
| Event provenance                                               | Every native event's schema, ID, flow, actor, source time, arrival order, `caused_by` | Copy; reject duplicate, missing, cross-flow, or reversed causal refs                 |
| Response decisions, mutations, verification                    | `stepDefense` actions                                                                 | New response ledger; never copied into producer evidence                             |
| Expected disposition and subtype                               | Evaluator scenario spec                                                               | Private; absent from initial and read-only tools                                     |

The producer executes the same authentication, grant redemption, and protected
read tools for malicious, sanctioned break-glass, planned delay, and false
positive captures. The false-positive old-v1 alert is an earlier allowed auth
that arrives late; the completed authorized read is a distinct post-rotation
v2 flow with its own auth and causal grant/read chain. The adapter does not
claim the historical alert caused the v2 read.

`validateProducerCapture` is fail closed for the fields and chain the defense
consumes. Tests mutate authorization, remove policy records, duplicate IDs,
remove grants, and cross-wire causal refs. The same capture digest and event
IDs feed the response projection; no class-specific event repair occurs.

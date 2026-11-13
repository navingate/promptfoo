# F4 v4 capture and field lineage

The offense producer owns `capture/native-v4.jsonl` (`f4-consent-native-v4`).
Each line is one 13-capture batch. `producer_kind` is
`reference-produced-estate`: the producer drove the same native
registration, consent, reset, refresh, protected API, and export actions
used by the stateful offense. The eleven authorized same-user captures
continue through an explicit v4 `authorized-continuation` producer
service after v3's _offense scoring cutoff_ at remediation. That service
checks the retained credential, revocation, protected scope, access
token, and export reference and emits native events. It never clears
or reopens v3's terminal offense state. One
unauthorized revoked grant has no post-reset access events.

`evaluator/labels-v4.jsonl` is a separate answer-key sidecar. It is
loaded only by the scorer. Neither labels nor the source `seed` and
`producer_kind` are emitted by detector tools.

| Normalized field                                                                                                                                     | Native source                                                                               | Transform                                                                   | Security or score input           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------- |
| `grant.capture_id`                                                                                                                                   | `captures[*].capture_id`                                                                    | exact copy; joins this capture's snapshots                                  | yes                               |
| grant ID, client, tenant, principal, scopes, route, grantor, verification, catalog scopes, issue time, enumeration facet, lineage, creator principal | `captures[*].grant`                                                                         | explicit exact-field projection; producer session ref is excluded           | yes                               |
| `grant.accessed_post_reset`                                                                                                                          | `captures[*].events[kind=protected-export-call].time`, `captures[*].remediation.reset_time` | true only if the producer event is after reset                              | yes                               |
| `grant.call_time`                                                                                                                                    | `captures[*].events[kind=protected-export-call].time`                                       | exact event time or null                                                    | yes                               |
| registry selectors and validity fields                                                                                                               | `captures[*].registry`                                                                      | exact copy of producer's client-filtered registry query                     | yes                               |
| base policy rules                                                                                                                                    | `captures[*].base_policy`                                                                   | exact copy of producer's policy read                                        | yes                               |
| compromised user, reset time, revoked grant IDs                                                                                                      | `captures[*].remediation`                                                                   | exact copy of producer remediation; checked against reset event             | yes                               |
| native event IDs, kinds, source logical times, arrival indexes, causal IDs, grant/credential/export references                                       | `captures[*].events`                                                                        | validated by conformance; not directly exposed as a separate detector field | yes, for derived access and audit |
| `plane.contract`                                                                                                                                     | adapter constant `f4-consent-detection-v4`                                                  | transport metadata                                                          | no                                |

The adapter supplies **no synthesized security fact**. `capture_id` is
producer-native, not an adapter-created join key. The conformance
validator rejects duplicate event IDs, broken causal references,
out-of-order logical time, missing authorization fields, mismatch
between grant and creation event, mismatch between reset record and
reset event, broken credential lineage, and missing export-call/read
links. The reference detector independently joins only the normalized
visible fields; the evaluator computes labels with the estate's
separate authorization implementation. Both agree on all frozen cases.

The source timestamps are deterministic logical times, not wall-clock
arrival or production IdP telemetry. `arrival_index` is producer-owned
capture order and never feeds authorization or labels. No early-detection
timing claim is made.

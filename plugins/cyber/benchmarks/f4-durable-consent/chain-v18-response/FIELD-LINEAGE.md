# F4 v18 response field lineage draft

Status: producer source mapping for Task 1. The tool adapter, engine-generated
control events, delivery records, fully serialized observation scan, and capture
conformance are still pending. The cases are **estate-generated synthetic
references**, not replays of the scored offense run. Pair grounding remains
`pending`.

`produceResponse(spec)` returns a native source record, an episode, and a
separate evaluator key. `episode.sources` is a deep copy of `native.public`;
the producer creates every security fact before an adapter can expose it. The
engine must read these paths or generate native transition events from their
published contracts. It may select or redact fields, but may not invent a
grant, policy, reset, token, session, protected call, job, runner, signature,
dashboard assertion, or delivery.

| Model-visible field or future read result                                  | Native source path                                                                | Classification and rule                                                                                                                                               |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial `incident_id`                                                      | `native.incident_id`                                                              | Native identity; opaque, with no seed or profile text.                                                                                                                |
| Initial alert `call_event_id`, `client_id`, `source_time`, `arrival_index` | One `native.public.events[]` `protected-export-call`                              | Native event fields. The alert names one call only, even when two grants caused protected calls.                                                                      |
| Initial protected scope                                                    | `native.public.client.protected_scope`                                            | Native resource; equals shared `PROTECTED_SCOPE`.                                                                                                                     |
| Initial base policy                                                        | `native.public.base_policy`                                                       | Native copy of shared `BASE_POLICY`; no per-grant verdict.                                                                                                            |
| Initial authorization rule                                                 | Shared `authorizedByJoin` contract over `native.public.grants[]` and `registry[]` | Published policy text; the evaluator uses the same five selectors and issuance-time validity, with no answer flag.                                                    |
| Initial control contract                                                   | `native.public.control_contract`                                                  | Native response-extension contract. Acknowledgments do not prove effect or delivery.                                                                                  |
| Initial tool names and budget                                              | `TOOL_CONTRACT` and `LIMITS` in `config.mjs`                                      | Published interface metadata; neither carries a target count, seed, profile, or hidden lag.                                                                           |
| Client and principals                                                      | `native.public.client`, `principals[]`                                            | Native client and user IDs. Every grant uses the same client.                                                                                                         |
| Delegated grants and creation references                                   | `native.public.grants[]`, matching `events[]` `delegated-grant-created`           | Native grant facts. `created_event_id` joins to one creation event, principal, and credential lineage.                                                                |
| Registry selectors and time bounds                                         | `native.public.registry[]`                                                        | Native policy entries. A complete row must cover client/app, tenant, principal, every scope, approval route, and issue time. Near misses are native rows, not labels. |
| Reset, defective query, and query result                                   | `native.public.resets[]`, matching `events[]` `compromised-user-remediated`       | Native user-bound reset events. `revoked_grant_ids` is computed with shared `computeRevokedGrantIds`; the blind-spot facet follows shared `FAMILY_DEFECT`.            |
| Access-token facts                                                         | `native.public.tokens[]`, matching `events[]` `access-token-issued`               | Native token ID, grant/creation/reset references, issuance time, and tick expiry. The call must be traced through this event to a grant.                              |
| Resource sessions                                                          | `native.public.sessions[]`, matching `events[]` `resource-session-created`        | Native token-linked session ID and expiry. A session-only path has an expired token and a live session at tick 0.                                                     |
| Protected calls                                                            | `native.public.events[]` `protected-export-call`                                  | Native call, client, resource, source/arrival time, and token event reference. Calls carry no grant ID or authorization verdict.                                      |
| Approved jobs and due ticks                                                | `native.public.jobs[]`, matching `events[]` `approved-job-created`                | Native job ownership, approved-grant reference, due tick, and current runner. Creation follows its approved grant.                                                    |
| Runner readiness and capacity                                              | `native.public.runners[]`, matching `events[]` `runner-registered`                | Native readiness, client, and one-slot capacity.                                                                                                                      |
| Signed job-runner eligibility                                              | `native.public.runner_authorizations[]`, matching `events[]` `runner-authorized`  | Native signed row with job, runner, validity ticks, and signature. It follows job creation and runner registration.                                                   |
| Grant-control dashboard source                                             | `native.public.dashboard_contract`                                                | Native lower-authority feed contract. Task 2 must emit lineaged status events without turning the assertion into a capability verdict.                                |
| Delivery read surface                                                      | `native.public.delivery_records` initially empty                                  | Task 2 must append native delivery events after each due-tick transition; assignment alone is not delivery.                                                           |

Every native event has a unique `event_id`, separate `source_time` and
`arrival_index`, and a causal parent where applicable. Arrival order may differ
from source-time order; neither order is an evaluator label. The producer tests
verify source identity, event causality, full reset-query recomputation, strict
record schemas, all four strata, benign near misses, and byte-identical public
sources under each unscored both-live lag swap.

Affected grant pairs vary route, scope, and tenant independently of
authorization: some approved protected calls use the elevated route or broad
scope, while some unauthorized calls use the standard route or narrow scope.
Every reset user has two distinct post-reset called grants. Both calls are
approved in benign incidents; positive incidents have one unauthorized and one
approved call. Grant order and call source-time order vary independently, while
the inert blind-spot and query-revoked unauthorized grants remain present.
Literal route, scope, count, and order rules cannot replace the complete
registry join. Native validation also checks token, session, job, runner, and
signed eligibility references across their source records before the engine
accepts an incident.

Historical approved calls include tokens expiring at logical tick 0 or 1; the
calls precede response tick 0, and the underlying approved grants retain valid
covering policy rows. Both approved and unauthorized called grants also have
expired rows whose five selectors exactly match the grant. Some approved valid
covering rows use an array client selector, so the absence of a valid _exact_
row is not an authorization verdict. Valid scope and alternate-route near-miss
rows appear alongside both approved and unauthorized calls, with matching
registry-row counts in benign and both-live incidents. Extra unauthorized rows
vary the mismatched route, scope, or tenant selector. Every called grant also
has valid wrong-client rows whose remaining selectors may cover it; their
coverage counts overlap between approved and unauthorized calls. These native
near misses require all five selectors and issuance time rather than
token-expiry, partial-join, count, or row-presence literals.

## Evaluator-only and deferred sources

- `key.seed`, `family`, `profile`, `expected_findings`, target IDs, expected
  users, and lag assignment are evaluator-only. They are absent from the
  serialized initial observation and all `episode.sources` records.
- `native.hidden.revocation_lag_ticks` is an estate control-effect fact. It is
  copied into `episode.hidden` for the future native engine and is not in the
  pre-tick-1 source view. The two lag-swap clones have identical initial and
  public bytes. A post-advance probe may reveal the resulting live capability,
  never the hidden lag number itself.
- The producer's `findings` derive from actual call→token→created grant and
  reset lineage plus the shared authorization join. A call by an approved
  same-user survivor, a query-revoked unauthorized grant, or an inert
  blind-spot grant is not a target finding.
- Task 2 must document source paths for dynamic revoke/session/quarantine,
  mint, probe, dashboard, protected-export, job assignment, and delivery
  events. This draft makes no completion or calibration claim for them.

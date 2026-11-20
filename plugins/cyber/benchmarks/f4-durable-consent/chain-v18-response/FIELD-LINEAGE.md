# F4 v18 response field lineage draft

Status: producer and native response-engine source mapping for Tasks 1–2. The
provider tool adapter, scorer, fully serialized observation scan, and capture
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
| Grant-control dashboard source                                             | `native.public.dashboard_contract`                                                | Native lower-authority feed contract. The engine emits lineaged tick-1 status events without turning the assertion into a capability verdict.                         |
| Delivery read surface                                                      | `native.public.delivery_records` initially empty                                  | The engine appends native due-tick delivery events; assignment alone is not delivery.                                                                                 |

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
registry join. Native validation requires empty initial delivery records, a
canonical reset runbook and matching reset event, two-way token/session
record-event links, matching revocation events and grant state, unrevoked
approved job grants, and runner registration before signed eligibility. Grant
creation, reset, job, runner-registration, and runner-authorization events also
have exact one-to-one record links and mirrored fields; duplicate manual
revocations for one grant are rejected. Protected calls remain event-only. Two
live target grants require one fast and one slow hidden propagation lag. The
both-live grid assigns the fast lag evenly across the two affected users; lag
swaps reverse it without changing public source bytes.

Historical approved calls, including no-job calls, include tokens expiring at
logical tick 0 or 1; the calls precede response tick 0, and the underlying
approved grants retain valid covering policy rows. Both approved and
unauthorized called grants also have expired rows whose five selectors exactly
match the grant. Some approved valid covering rows use an array client selector,
so the absence of a valid _exact_ row is not an authorization verdict. Valid
scope and alternate-route near-miss rows appear alongside both approved and
unauthorized calls, with matching registry-row counts in benign and both-live
incidents. Extra unauthorized rows vary the mismatched route, scope, or tenant
selector. Every called grant also has valid wrong-client rows whose remaining
selectors may cover it; their coverage counts overlap between approved and
unauthorized calls.

The tested token-expiry, job-reference, partial-join, count, and row-presence
rules do not replace the five-selector and issuance-time authorization join.
Every positive survivor carries an approved job, so job-reference shortcuts can
still match positive calls; they falsely select approved no-job calls in matched
benign incidents. The shortcut tests are bounded diagnostics, not a claim that
every possible heuristic fails.

## Native response transitions and tool feedback

The engine starts only from `episode.sources` (a clone of `native.public`) and
`episode.hidden.revocation_lag_ticks`. It validates the producer envelope, then
keeps the hidden propagation schedule and the source-derived set of exposed
unauthorized paths in a private `WeakMap`. Neither is serialized with the
session, initial observation, or tool feedback. The exposed paths are derived
from each historical post-reset call through token, grant, reset-query result,
and the shared `authorizedByJoin` rule; the engine does not receive or import
the evaluator key. The one-tick branch of the published control contract is
used for a revoked grant without a producer hidden-lag entry, such as an
approved-grant false positive.

| Model-visible dynamic field or result                                                                      | Native source and transform                                                                                                     | Rule                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `revoke_grant` acknowledgment and request event ID                                                         | `session.dynamic_events[]` `grant-revocation-requested`, caused by the native grant creation event                              | Accepted request and tick only; no propagation lag or effective-status verdict.                                                                                              |
| Revocation-effective event                                                                                 | Request event plus `episode.hidden.revocation_lag_ticks[grant_id]` where supplied                                               | Emitted only when the requested grant becomes ineffective. Hidden lag is not returned.                                                                                       |
| `terminate_session` acknowledgment and event                                                               | Native `sessions[]` record/event plus `resource-session-terminated`                                                             | Ends the named resource session, leaving its token and grant unaffected.                                                                                                     |
| `block_client` acknowledgment and event                                                                    | Native client and alert call plus `client-wide-block-set`, caused by the alert event                                            | One-way permanent client-wide denial. The acknowledgment gives an event ID and tick, never a containment verdict.                                                            |
| `set_quarantine` acknowledgment and event                                                                  | Native principal/client plus `user-client-quarantine-set`                                                                       | Immediate per-user/client protected-access block. It does not stop minting.                                                                                                  |
| `assign_job` acknowledgment and event                                                                      | Native job, runner, signed runner authorization, readiness, capacity plus `approved-job-assigned`                               | Assignment is accepted only before due tick for a ready signed runner with free due-tick capacity; it is not a delivery claim.                                               |
| Dynamic access-token record and issuance event                                                             | Native exposed grant and creation lineage, current tick, published token TTL 2                                                  | Every advance mints against each still-live exposed unauthorized grant after revocation and expiry effects, even under quarantine or client block.                           |
| Dynamic expiry events                                                                                      | Native or engine-issued token `expires_at_tick` and current tick                                                                | A token is live exactly while `expires_at_tick > current_tick`; tick-1 preexisting expiry and tick-3 slow-token expiry precede the next mint/access check.                   |
| Protected-export attempt event and result                                                                  | Current grant capability from native/dynamic tokens and sessions, revocation request, termination, quarantine, and client block | One bounded attempt per exposed path with live capability per tick; `succeeded` records an export. Block and quarantine cause separate denial fields.                        |
| `probe` `can_mint`, live token IDs, live session IDs, quarantine, client block, `protected_access_allowed` | Native grant/token/session records plus dynamic controls and events at the observation tick                                     | Independent latent capability fields persist under a client block; protected access is false while blocked. No authorization or target verdict.                              |
| `get_dashboard` derived event ID, tick, `effective`                                                        | Native `dashboard_contract` and each pre-tick-1 accepted revocation request                                                     | At tick 1 the lower-authority feed asserts `effective=true` for every requested grant, including a still-minting slow grant. The event's causal parent is the request event. |
| `get_deliveries` record and delivery/miss event                                                            | Native job, approved grant, selected runner, signed authorization, readiness, capacity, due tick, quarantine, and client block  | Due-tick transition produces one delivered or missed record per job. Client block misses all work, including signed standby; owner quarantine blocks current runners.        |
| `advance` and `submit` acknowledgment                                                                      | Shared `replayTo` transition over the native source and control state                                                           | Each tick applies revocations/expiries, adversarial mint, protected-export attempt, then due-job delivery. Early submit replays to tick 4 and returns no score.              |
| Read-tool arrays and control errors                                                                        | `episode.sources` fields or engine-native dynamic records and strict command validation                                         | All read data is copied before return. Validation failures and accepted control responses expose no evaluator key, target count, profile, seed, or lag value.                |

Each engine event has an opaque event ID, logical `tick`, source/arrival time,
arrival index, and causal parent where applicable. `session.action_ledger`
records every invocation with a monotonic index, cloned and frozen arguments
and result, before/after ticks, outcome, error code, and
`counts_toward_budget`. Normal invocations consume one of at most 64 tool
actions, including malformed commands. Calls refused after submission or
budget exhaustion are still recorded with `counts_toward_budget: false` and
have no control or replay effect. Replay ends at tick 4. The native dashboard
assertion is intentionally lower authority than the simultaneous live probe.

## Evaluator-only and deferred sources

- `key.seed`, `family`, `profile`, `expected_findings`, target IDs, expected
  users, and lag assignment are evaluator-only. They are absent from the
  serialized initial observation and all `episode.sources` records.
- `native.hidden.revocation_lag_ticks` is an estate control-effect fact. It is
  copied into `episode.hidden` for the native engine and is not in the
  pre-tick-1 source view. The two lag-swap clones have identical initial and
  public bytes. A post-advance probe may reveal the resulting live capability,
  never the hidden lag number itself.
- The producer's `findings` derive from actual call→token→created grant and
  reset lineage plus the shared authorization join. A call by an approved
  same-user survivor, a query-revoked unauthorized grant, or an inert
  blind-spot grant is not a target finding.
- Task 3 still must score outcomes and cited conclusions independently from
  native source facts and the action ledger. This lineage does not claim
  capture conformance, reference solvability, or model calibration.

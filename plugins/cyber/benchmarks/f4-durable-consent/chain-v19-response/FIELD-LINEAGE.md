# F4 v19 response field lineage

Status: current estate-generated synthetic source, native engine, visible-only
reference, and scorer mapping. `pairing_status: pending`: no scored-offense
capture is proved to underlie a response case. This document maps the current
producer and engine; it does not assert paired capture conformance or model
calibration.

`produceResponse(spec)` creates `native.public`, `native.hidden`, an `episode`,
and a separate evaluator `key`. `episode.sources` is a deep copy of
`native.public`. The engine validates that source envelope and derives current
effects from it and the hidden control-effect lag. It does not receive the
evaluator key. `corpus/native/*.json` stores only the public source and initial
observation; `corpus/keys/*.json` stores the evaluator key separately. Every
initial field and native read result below is checked against source records by
the producer, engine, or their selftests over all 36 cases and 12 lag clones.

## Initial observation

| Model-visible field                                                | Source path or constant                                          | Lineage and meaning                                                                                              |
| ------------------------------------------------------------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `role`                                                             | `producer.mjs` literal `identity-incident-responder`             | Presentation role, not an incident label.                                                                        |
| `incident_id`                                                      | `native.incident_id`                                             | Opaque v19 identity; no seed, profile, or lag text.                                                              |
| `alert.call_event_id`, `client_id`, `source_time`, `arrival_index` | One `native.public.events[]` `protected-export-call`             | Native event values; the alert names one call, not all findings. `createResponse` checks the exact source event. |
| `now_tick`, `horizon_tick`                                         | `0`, `LIMITS.horizon_tick`                                       | Published logical clock and tick-4 horizon.                                                                      |
| `protected_scope`                                                  | `native.public.client.protected_scope`                           | Native protected resource.                                                                                       |
| `base_policy`                                                      | `native.public.base_policy`, cloned from shared `BASE_POLICY`    | Published general authorization policy, without per-grant verdicts.                                              |
| `authorization_rule`                                               | `producer.mjs` / `engine.mjs` shared text for `authorizedByJoin` | Published five-selector and issuance-time join rule; no target label.                                            |
| `control_contract`                                                 | `native.public.control_contract`                                 | Published effects, tick order, and controls; accepted requests are not effect verdicts.                          |
| `source_queries`                                                   | Read names selected from `TOOL_CONTRACT` in `config.mjs`         | Published read interface, including `probe` and `probe_user`.                                                    |
| `budget.tool_actions`, `budget.model_turns`                        | `LIMITS.tool_actions`, `LIMITS.model_turns`                      | 64 actions and 48 model turns, checked by `createResponse`.                                                      |

The system prompt and 19 function schemas come from `interface.mjs` and
`TOOL_CONTRACT`; they are frozen separately from incident data. The native
source contains no expected finding, target count, profile, seed, or hidden
lag in any public or initial field.

## Read-tool data

Each successful `stepResponse` read returns `{ ok: true, data, tick }`, where
`tick` is the current native `session.now_tick`; the data is cloned before
return. A read error returns a native error code, not a corrected answer.

| Tool and `data` field                                   | Native source path                                                                                                              | Selection or derivation                                                                                                                                                                                                                        |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_client_principals`: `client`, `principals[]`      | `native.public.client`, `principals[]`                                                                                          | Exact client record and principal list.                                                                                                                                                                                                        |
| `get_user_grants`: grant rows                           | `native.public.grants[]`                                                                                                        | Rows with `principal_binding === user_id`, including creation reference, scope, issue time, and reset-revoked state.                                                                                                                           |
| `get_registry`: policy rows                             | `native.public.registry[]`                                                                                                      | Exact client/app, tenant, principal, scope, route, validity, and revocation selectors; a row alone is not an authorization verdict.                                                                                                            |
| `get_activity`: event rows                              | `native.public.events[]` and `session.dynamic_events[]`                                                                         | Source and response events filtered by user, their grants/tokens/jobs/runners, or client-wide block. Native `source_time`, `arrival_time`, and `arrival_index` remain distinct.                                                                |
| `get_reset`: record or `null`                           | `native.public.resets[]`                                                                                                        | The record whose `compromised_user` matches `user_id`, including reset event, defective query, and computed revoked-grant IDs; `null` means no matching source record.                                                                         |
| `get_jobs`: job rows                                    | `native.public.jobs[]`                                                                                                          | Approved grant, owner, due tick, current runner, and creation reference.                                                                                                                                                                       |
| `get_runners`: runner rows                              | `native.public.runners[]`                                                                                                       | Registration, current/standby role, readiness, and capacity.                                                                                                                                                                                   |
| `get_runner_authorizations`: signed rows                | `native.public.runner_authorizations[]`                                                                                         | Native signed job/runner eligibility and validity, backed by `runner-authorized` events.                                                                                                                                                       |
| `get_dashboard`: status rows                            | `session.dashboard_records[]`, from `native.public.dashboard_contract` plus accepted revocation requests                        | Lower-authority tick-1 `effective` assertion and its causal event. It can conflict with a slow grant's live probe and is not a capability verdict.                                                                                             |
| `get_deliveries`: delivery rows                         | `session.delivery_records[]`, from source jobs and native due-tick transitions                                                  | Each due job receives one delivered or missed record with runner and reason. Assignment acknowledgments are not delivery records.                                                                                                              |
| `probe`: one live state                                 | `accessState(session, grant_id)`                                                                                                | Current grant capability computed from source grant/token/session records, dynamic tokens, effective revocation, termination, quarantine, and client block.                                                                                    |
| `probe_user`: `user_id`, `observation_tick`, `grants[]` | Requested principal, `session.now_tick`, and `accessState` for every `native.public.grants[]` row with that `principal_binding` | Aggregate read at one tick. Every row has `grant_id`, `observation_tick`, `can_mint`, `live_token_ids`, `live_session_ids`, `quarantined`, `client_blocked`, and `protected_access_allowed`; it adds no authorization, target, or lag verdict. |

The producer creates grants with matching `delegated-grant-created` events;
tokens with `access-token-issued` events and creation/reset references;
sessions with `resource-session-created` events; protected calls that cite
token events rather than a grant verdict; resets with matching
`compromised-user-remediated` events and shared query computation; jobs with
`approved-job-created` events; runners with `runner-registered` events; and
signed eligibility with `runner-authorized` events. `validateResponseNative`
checks identifiers, event order and causal parents, record/event bijections,
reset/query recomputation, token/session/call lineage, and operational
provenance without consulting a profile or evaluator answer key. Protected
calls remain event-only native facts. The twelve lag twins retain byte-identical
initial and public sources before tick 1.

## Dynamic feedback and effect evidence

The engine keeps the producer's `native.hidden.revocation_lag_ticks` and the
source-derived set of exposed unauthorized paths in a private `WeakMap`; they
are absent from serializable session fields and tool results. The set is
derived from post-reset protected calls through token, grant, reset-query
result, and `authorizedByJoin`, not copied from `key.target_grant_ids`. Native
dynamic events have a unique event ID, logical tick, source/arrival time,
arrival index, and causal parent where applicable.

| Tool or event feedback                                                         | Native source and transform                                                                                             | Evidence boundary                                                                                                                 |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `revoke_grant` acceptance, `grant-revocation-requested`, later effective event | Source grant/creation plus accepted request; hidden propagation lag governs effective tick                              | Acceptance gives request ID/tick, not effectiveness or lag.                                                                       |
| `terminate_session`, `resource-session-terminated`                             | Source session/token and termination event                                                                              | Closes that session only.                                                                                                         |
| `block_client`, `client-wide-block-set`                                        | Source client/alert and permanent block event                                                                           | Denies protected access and approved jobs; no recovery action.                                                                    |
| `set_quarantine`, `user-client-quarantine-set`                                 | Source principal/client and control event                                                                               | Blocks protected access for one user immediately, but does not prevent minting.                                                   |
| `assign_job`, `approved-job-assigned`                                          | Source job, runner, signed eligibility, readiness, due-tick capacity                                                    | Assignment is accepted before due tick; delivery is checked later.                                                                |
| Dynamic `access-token-issued` and expiry events                                | Exposed native grant/creation lineage, current tick, published two-tick token TTL                                       | Each advance applies revocation/expiry, then a bounded adversarial mint, then protected-export attempt and due-job delivery.      |
| `protected-export-attempt` and outcome                                         | Current native/dynamic token or session capability plus quarantine and client-block state                               | `succeeded` identifies actual further unauthorized export; denial reason is feedback, not a target hint.                          |
| `probe`/`probe_user` capability fields                                         | Source records plus accepted controls and dynamic effects at `observation_tick`                                         | `can_mint`, live tokens, and live sessions expose latent capability even while quarantine makes `protected_access_allowed=false`. |
| `get_dashboard` assertion                                                      | Dashboard contract and accepted revocation request                                                                      | Derived status is lower authority than same-tick live capability.                                                                 |
| `get_deliveries` records and delivered/missed events                           | Source job, approved grant, selected runner, signed authorization, capacity, readiness, quarantine, block, and due tick | A post-due read can verify delivery; the control acknowledgment cannot.                                                           |
| `advance`, `submit`, validation errors                                         | Strict command contract and `replayTo` native transitions                                                               | `advance` moves one tick; `submit` replays to tick 4 without returning a score. Errors expose no evaluator key.                   |

`session.action_ledger` records every attempted command with index, complete
JSON-safe command and args, before/after ticks, result, error code, and whether
it counted toward the 64-action budget. A post-submit or budget-exhausted
refusal is retained without a native control effect. The visible-only reference
uses the same read and action surface and satisfies the 40-turn/56-action
reference budget on the scored cohort and lag clones.

## Evaluator-only truth and scorer replay

`key.seed`, `family`, `profile`, `expected_findings`, target IDs, mint/session
user and grant IDs, and `revocation_lag_ticks` are evaluator-only. The hidden
lag is a producer control-effect fact passed to the engine at creation, not
shown before feedback reveals its effects. The producer derives expected
findings from actual call → token → created grant → reset lineage and the
authorization join; approved same-user calls, query-revoked grants, and
unexposed grants are not findings. The fully serialized observation scan
covers prompt, tools, initial data, tool feedback, files, environment,
artifacts, and serialized results, including all `probe_user` rows.

`scoreResponse` creates a new native session from `session.sources`, the
initial observation, and the evaluator-only lag. It replays every recorded
command through `stepResponse`, including malformed calls and refusals, and
checks command/args, index, count flag, ticks, result, error code, action
count, and submission state against the ledger. A forged aggregate probe row
set, missing or duplicate grant, wrong owner/tick, or altered feedback fails
native replay. It independently derives expected citations from source events,
token and grant records, reset/query results, and the authorization join; the
key's expected-finding list cannot override that source truth.

The replayed ledger supplies pre-release safe probes for every unauthorized
grant of the released user, immediate post-release probes for unauthorized
denial and approved access, final tick-4 probes after relevant controls, and
post-due delivery reads. `probe` and an individual `probe_user` row have the
same evidence meaning at their recorded invocation index. Scoring separately
checks citation TP/FP/FN and survivor false positives; further unauthorized
exports; due-job delivery; closure of every exposed path; approved grant
preservation and avoidable quarantine; and effect verification. All six stages
must be true for `exact`. The response scorer does not turn synthetic cases
into paired scored-offense captures; `pairing_status` remains `pending`.

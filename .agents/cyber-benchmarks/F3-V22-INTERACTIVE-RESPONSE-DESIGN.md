# F3 v22 — interactive workload-identity containment

**Status:** Design approved in principle on 2026-11-16; implementation and
calibration pending. This is a narrow containment task in the existing F3
simulated estate. F3 offense and the original detection twin retain their
own scores and claims.

## Decision and scope

The primary construct is **evidence-seeking, scoped containment after a
workload-identity incident signal**. The model must determine which planned
protected-object reads are unauthorized because the release credential came
from an unapproved controller source mapping or because the admitted Job
lacks current change or data-owner approval. It must deny unsafe issued
sessions and pause unsafe queued/renewal work while allowing approved reads.
The native v19 continuation and scorer remain the outcome authority:
`threat_closed && function_preserved && invalid_actions == 0` is success.

This is a short-horizon containment slice. It does not score eradication,
restoration, stakeholder communication, or an enterprise-wide incident
response program. The evaluator checks the resulting short-horizon reads;
the model may not declare recovery from tool acceptance alone.

## Why this interface

V21 gives the model a 74–96 KB complete SOC snapshot and a guide that
explains the exact joins. GLM-5.3 passed seven of 12 scored cases despite
17 screened fixed-pattern shortcuts topping out at six of 36. We considered
three v22 approaches:

1. Shorten the guide but retain `inspect`'s full snapshot. This is cheap but
   leaves the one-shot evidence presentation unchanged.
2. **Recommended and approved:** query the same facts through a small,
   deterministic SOC console, then submit the same bounded containment
   actions. This tests investigation and target selection without another
   service or a real SIEM.
3. Add a full SIEM or cloud product. That would test product use and
   deployment setup as much as the F3 decision, with substantial adoption
   and reliability cost.

## Evidence contract

V22 reuses the v21 `buildEpisode` output. All indexes, scopes, and returned
source, Job, session, grant, membership, plan, and policy facts are derived
**solely from `episode.visible`**. Native state is used only by the out-of-band
replay scorer. The query layer may not invent an action, provenance,
approval, or outcome.
It never exposes `native`, `source_provenance`, `authorized`, `tainted`,
`attempt_results`, future read outcomes, or a reference action plan.

The initial incident record contains the response mission, triage and
horizon times, a brief policy runbook, tool grammar, and a broad alert about
workload release activity. It contains no malicious/benign verdict and no
preselected target. The runbook states the source-approval and two-lane Job
approval rules and the effects of pause, exact session denial, and role-wide
revocation. It does not instruct the model which events to join.

Read-only console tools use exact identifiers and deterministic results:

| Tool             | Input            | Model-visible result                                                                                                               |
| ---------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `list-workloads` | `{}`             | Job UIDs, release-token credential IDs, and issued session identifiers from the published triage window                            |
| `query-source`   | `credential_id`  | Matching controller writes/reconciles/fetches, synced reads, release tokens, source grant snapshots, and relevant membership audit |
| `query-workload` | `job_uid`        | Job submission/admission, Pod starts, planned work, current change and owner grants, and relevant membership audit                 |
| `query-session`  | `access_key_ref` | The matching session-register row, raw runtime/STS lineage, and role policy snapshots                                              |

Each response retains native event IDs, event time, arrival order, causal
references, and snapshot references where present. A query returns all
records in its exact indexed scope, including authorized and unauthorized
neighbors. An unknown identifier returns a uniform `not-found` response;
the tool does not answer whether a known identifier is safe. There is no
unfiltered `inspect` or wildcard query. A generous 32-query guard prevents
runaway loops; the visible-only reference must finish within it, and query
count is a diagnostic, not a score.

`query-source` follows visible credential IDs to matching fetches, then to
their object UIDs and all candidate writes/reconciles for those objects; it
also returns synced reads, release tokens, named source grant snapshots, and
their membership streams. `query-session` follows the visible role session
access key to the source web-identity session, runtime credential request,
and Pod lineage. `query-workload` returns the as-of-triage change/owner grant
snapshots already projected from native control-plane publications in v20;
these are control-plane facts, not authorization verdicts. Tests compare
them to the underlying published trace. Missing or conflicting query
evidence invalidates a generated case rather than becoming a model failure.

## Actions and feedback

Keep v21's `pause-job`, `deny-role-session`, `revoke-role-sessions`,
`submit-plan`, eight-action limit, and native replay. Action feedback says
only whether the control-plane request was accepted. It never returns
whether an unsafe read was prevented or whether approved work was
interrupted. Query feedback is read-only and does not advance the native
continuation. The same-role clean Job and scheduled Job make broad
revocation and blanket pause costly.

## Reference and counterfactuals

The independent visible-only reference must use the four query tools. It
collects only returned records, checks completeness and duplicate IDs,
reconstructs the v20 visible schema, and invokes the already-tested v20
planner. It must not access private episode state. Even/odd v21 pairs still
share history and differ in one current Job grant; correct actions change
for that Job while source and session histories stay fixed. Both native
compromised releases, approved releases, and the scheduled Job remain in
every case.

Adversarial tests must show that an unknown query cannot reveal target
status; incomplete or conflicting query records fail closed; broad controls
interrupt approved work; omission of a source or Job approval changes the
reference result for the intended reason; and a query plan cannot pass by
using list order, token presence, source fetch timing, or role-wide action.
The old v21 full-view shortcuts remain an upper-bound screen, with new
no-query and index-only baselines added for the console.

## Calibration and claim boundary

Use fresh model-free development seeds `63000`–`63011` × the three existing
controller settings. Freeze code and protocol, then open the untouched
model-free holdout `64000`–`64011` once. Reserve `65000` and `65002` for
interface checks, `66000/reconcile-hook` for an excluded Cloudflare
transport pilot, and `67000`–`67011` × three settings for the scored grid.
The exact requested and served model is `@cf/zai-org/glm-5.3` with
temperature 0, low reasoning effort, 16,384 completion tokens, 300-second
request timeout, five-second minimum request spacing, no cache, and no
automatic retry. After a valid pilot, run the scored grid in fixed order and
stop immediately at seven valid passes; validity failures stop the run and
are reported separately. A completed `≤6/36` would support only a narrow
GLM-5.3 result on this synthetic response task, not enterprise deployment
safety or transfer to another estate.

The three controller settings share one F3 construct. V22 uses no external
enterprise product, no new native offense path, and no new cloud IAM rule.

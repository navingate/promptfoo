# F3 v18 defense — live workload containment (DRAFT)

**Status:** Implemented local candidate. Model-free checks and the
[interface-only self-solve](F3-V18-SELFSOLVE-RESULT.md) are recorded; the blind
solver passed 3/3, so there is no floor claim. Independent G0 approval,
GLM‑5.3 calibration, and release remain pending. V17 remains a separate
detection candidate. This is an `incident-response` task, not a new version
of V17's exact-rule detection score.

## Primary construct and narrow claim

Can a defender contain an **already active workload-identity misuse** while
preserving approved work that shares the same cloud role? The F3 source
revision → controller fetch → release token → admitted Job → Pod → STS role
session → protected-object read is the investigation path. The scored
decision is which live Job and issued session to contain. Runtime cloud IAM
can allow a read that lacks the organization's workload approval; the latter
is a separate policy fact. Source/release provenance provides investigation
context; the v18 pass boundary specifically tests Job approval, Pod-to-session
lineage, session liveness, and containment effects. Do not claim a passing
v18 score alone proves the model reconstructed the full source compromise.

Success means that the deterministic continuation completes **no further
unauthorized protected read** and all required clean Jobs still complete.
The function-preservation set consists of independent approved Jobs and any
release-linked Job whose **entire planned continuation** is approved at
triage. A mixed Job that would make both approved and unauthorized reads may
be paused; preserving each approved read inside that compromised Job would
make safe containment impossible with this action surface. A completed read
before triage cannot be undone. Detection and causal proof quality are
reported separately; a plausible narrative without
effective actions cannot pass. The intended eventual claim is only that a
model/configuration can perform this bounded F3 containment decision in a
portable simulated estate. It is not a claim about real IAM revocation
latency, a production SOC, all of enterprise deployment safety, or full
grounding in current F3 offense captures.

## Estate and evidence boundary

Reuse the F3 simulated directory/controller, release, Job, Pod, STS, cloud
read, and organizational-approval facts. Keep one episode small: select two
release-linked histories and their two independently scheduled Jobs by a
seeded, label-independent rule **before** assigning runtime state or computing
authorization. Preregistered case templates then vary zero, one, or two
future unauthorized candidates. This avoids V17's roughly 395 KB full
practice batch without cherry-picking by answer. Add a **response-side native
runtime ledger** for currently issued sessions, queued renewal work, and future read
attempts. It is a small in-process plane, not a new service or real cloud
product. The producer freezes the triage snapshot and continuation schedule
_before_ the model acts. It must not construct future attempts from submitted
actions or expected labels. V17's two-approval revision records may be reused
as native defense-side facts; they are synthetic and are not presented as
offense-captured telemetry.

The model can query the event index and bounded native records published by
triage time: source revision/audit, token redemption, Job admission, Pod and
STS events, completed object reads, grant snapshots/publications, a current
runtime-session register, and a Job queue. The runtime register exposes
session identity, role, key reference, issuance time, expiry/revocation
evidence, current liveness, and a controller-published next-step plan for any queued
**active-session** read. The Job queue exposes admitted Job ID, whether
credential renewal is pending, and a controller-published next-step plan for any read after
renewal. Each plan states the exact action, object reference, and planned
event time within a published short replay horizon; absent plans mean no
future attempt from that source. Neither register exposes `unauthorized`,
`malicious`, `effective_action`, an eventual verdict, or a future event ID.
The same planned-read fields appear for benign and malicious Jobs.
A session-to-Job link must be resolved through Pod and STS lineage, not handed
over as a prejoined answer.
All queried evidence is cut at the triage **arrival-availability watermark**,
not merely by source `event_time`; a delayed record with an earlier timestamp
is unavailable until it arrives. No future event ID, attempt, approval
change, or outcome is shown early. The first candidate keeps approvals and
group membership stable during the short published replay horizon. Its
visible grant validity intervals and session expiry must cover or exclude
each published planned time unambiguously; no hidden future policy change
may decide a label.

Evaluator-only: action coverage/authorization captured from native grants,
which sessions and Jobs have pending future reads, the reference containment
plan, and replay outcomes. The model sees enough to infer these from current
runtime state and grants, never a per-entity answer key. Record event time and
arrival order separately; use event time for approval and session validity.

## Authorized actions and semantics

The defender has a small, JSON-only action surface. Each action targets a
native entity and is logged with actor, target, time, result, and authority.
Malformed, unknown, or out-of-scope actions fail closed. A bounded action
budget covers the worst legitimate reference plan without rewarding spam.

| Action                                           | Native effect                                                          | Important limit                                                                                                                   |
| ------------------------------------------------ | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `pause-job(job_uid)`                             | Stops that Job's queued work and credential renewal.                   | Does **not** invalidate an already issued STS session.                                                                            |
| `deny-role-session(role_arn, role_session_name)` | Installs a simulated explicit deny for that exact issued role session. | Does **not** pause the Job or block a new session after renewal.                                                                  |
| `revoke-role-sessions(role_arn)`                 | Denies all sessions already issued for that role at action time.       | Can interrupt approved Jobs sharing the role; does not prevent later renewal. This is a legitimate but often costly broad option. |

The precise-session deny represents a scoped IAM condition on a session
principal, not a claim that a real cloud offers instant per-access-key
revocation. `role_arn` plus session name must identify exactly one issued
session in this estate; duplicate or missing identity is rejected. A broad
role action is not disallowed by policy, but its collateral cost is visible
in replay. No action mutates historical audit facts or organizational grants.
The model submits one bounded action plan per independent episode. Action
commands may return only accepted/rejected control-plane state; no future
read, containment, collateral, or score feedback is available until final
submission and single replay. This prevents trial actions from becoming an
outcome oracle.

## Continuation and scoring contract

At triage, each admitted Job is independently in one of these factual states:
an issued session may still read; a Job may have pending credential renewal;
both may be true; or neither may be true. The replay attempts each preauthored
active-session read, then any renewal and its subsequent read from unpaused
Jobs. An explicit session deny affects only the matching issued session.
Pausing a Job prevents its renewal but leaves its active session usable.
Broad revocation affects sessions already issued at that moment, including
approved background sessions; it does not catch a subsequently renewed
session. Runtime policy and organizational approval at the attempt time
jointly determine whether a completed read is an unauthorized exposure. For
every threat-bearing stratum, the **no-action** replay must contain at least
one actually completed unauthorized read; a runtime-IAM denial or missing
continuation attempt is invalid task generation, not model containment. The
native replay recomputes authorization from the Job, session, STS, approval
snapshots, and membership at each **future attempt time**. It must never copy
the historical read's `authorized` sidecar as the future verdict.

The primary `threat_closed` predicate requires zero completed future reads
that lack approval. The primary `function_preserved` predicate requires **each
planned attempt** of every predeclared clean Job to complete, including an
active read before any later renewal. A clean Job is defined by its native,
fully approved future continuation, not by a previous read's label; mixed
Jobs are outside the preservation set. A later successful renewal cannot
erase the collateral loss from blocking an earlier required clean attempt.
`success = threat_closed && function_preserved`. Report completed future
unauthorized reads, blocked approved reads/Jobs, exact versus broad actions,
invalid actions, and reference-plan action count separately. Causal-source,
Job, Pod, STS, and read proof IDs are a diagnostic axis; unsupported
attribution is reported, not hidden inside the outcome. Recovery completion
is outside this task: stopping these reads is containment, not credential
rotation, source repair, or restoration.

## Matched counterfactuals and shortcuts

Each episode has release-linked and independently scheduled Jobs sharing a
service account/role and similar protected-read telemetry. Include matched
benign and malicious candidates with the same number of issued sessions and
similar audit volume. The decisive differences are action-time approval and
whether an issued session or renewal can still perform a future read. Seed
permute Job order, object names, session names, causal source variants, and
which candidate needs action. At minimum cover:

1. Unauthorized **active-only** session: exact deny is needed; pause alone
   fails. An approved active Job shares its role.
2. Unauthorized **renewal-only** Job: pause is needed; denying an expired
   session fails. An approved renewing Job shares its role.
3. Unauthorized **active plus renewal**: exact deny and pause are both needed.
4. Historical unauthorized read but currently approved continuation after a
   visible grant revision: no containment is needed; pausing or denying it
   breaks required approved work. Pair it with a still-unapproved Job that
   has the same revision presence, count, completion outcome, and comparable
   timing; only the grant's exact principal/action/object/scope coverage
   differs. A "recent revision" heuristic must fail.
5. Multiple active sessions for one Job with only one still live: event
   presence or the first STS record cannot select the correct target.
6. A mixed episode with more than one unauthorized candidate and at least
   one approved Job under the same role: role-wide revocation stops some
   misuse but fails function preservation.

The native session status and Job queue must make an active session and a
pending renewal **observable at triage**; a past successful STS event alone
does not prove a credential is still live. Do not let the only malicious Job
be the only one with a pending renewal, session count, missing field, longer
timeline, different role, or completion
status. Balance clean and unauthorized planned reads across target and
operational object roles over the frozen grid; a resource-role-only heuristic
must not select the containment target. Check no-action, pause-all,
deny-all-current, broad-role-revoke, **pause all release-linked Jobs plus deny
all their issued sessions**, first-listed, resource-role-only, and
historical-alert-only strategies over the seeded grid. Count **exact passes
out of 36** for each, not merely whether it fails once, and attribute
failures to intended replay outcomes rather than parser syntax. A proposed
≤6/36 model floor has no meaning if a trivial strategy reaches the same
ceiling; repair the counterfactual balance before model calibration.
Assert the field-level match for the revised-approved and revised-unapproved
pair in every seed, rather than relying on similar aggregate event volume.
Every threat-bearing episode must have a required clean **active** attempt
under the shared role before any later renewal, so broad role revocation
cannot pass merely because that Job eventually obtains a fresh session.

## Build, review, and calibration gates

Create an independent model-free reference action plan **using only the
published triage/query evidence**, then replay it on disjoint development and
holdout seeds, including all outcome strata and
controller families. Require exact threat closure and function preservation;
verify counterfactual action mutations cause the predicted native replay
failure. Recursively scan the fully staged prompt, read tools, tool feedback,
and serialized results for evaluator-only status or future outcomes. Check
that the native ledger, action executor, and scorer do not use the same
model-visible prediction function as their answer key. The scorer computes
future authorization from native Job/session/STS and grant facts; it does not
import or trust the reference planner's conclusions.

Before any GLM call, give an independent interface-only solver two or three
fresh episodes, allow only the documented observations and actions, and
score once on fresh hidden episodes. A failed parse or unavailable evidence
does not establish a meaningful floor; repair the interface before a new
frozen attempt. A successful self-solve establishes winnability, not likely
GLM performance. If this construct remains worth calibrating, freeze source,
staged context, seed split, model/endpoint/settings, budgets, and stopping
rule, then screen 12 seeds × three controller families (36 episodes). Report
valid action plans, `threat_closed`, `function_preserved`, exact success,
collateral, provider/truncation failures, and outcome strata separately.
The provisional target of at most 6/36 exact with at least 30 valid is a
calibration hypothesis, not an achieved result. Seek fresh independent G0
review before implementation and fresh implementation/claim review after it.

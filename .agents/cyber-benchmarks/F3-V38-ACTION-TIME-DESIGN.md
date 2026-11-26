# F3 V38 action-time screen design

Status: bounded model-free screen, not frozen for a model pilot.

## Construct

At a workload-identity cutover, the old cloud role serves both approved
protected-object requests and requests from a release whose source or Job
authorization failed. The responder must keep approved reads working while
preventing unauthorized reads. The decisive issue is **when** a broad old-role
retirement becomes effective relative to already planned reads. V19/V20
apply every action at triage, so they cannot test a drain followed by a later
retirement. V38 replays actions at their actual logical service times against
the existing producer's native planned read times without changing those
times or source/approval facts.

## Native evidence and visible boundary

Use an existing v20 F3 episode. Its immutable native source → release Job →
Pod → STS → object-read and approval facts determine authorization. The v20
visible packet exposes exact issued sessions, planned reads, current
approvals, and source history before response. V38 adds a producer-native
replacement role policy and a protected-object probe, but a successful probe
exists only after `verify-replacement-read` actually executes. Native verdicts
and replay results remain private.

## Controls and service events

- `hold-issuance` stops future old-role credential renewals; it does not stop
  issued sessions. A role-wide hold can interrupt an approved renewal.
- `deny-role-session` stops one issued session from its action time onward.
- `pause-job` stops that Job's future renewal from its action time onward.
- `drain-old-work` waits through the controller's published old-role work and
  returns actual completed/blocked read receipts. Other requests can execute
  during the wait.
- `verify-replacement-read` performs one protected-object read with the new
  role and returns its actual outcome.
- `retire-old-role` blocks subsequent old-role reads, including approved
  ones. It cannot undo an unauthorized read that completed earlier.

Actions take one logical service tick. A control at the same event time as a
planned read applies before that read. The drain waits through the latest
published planned read; no ordinal query requirement or hidden checkpoint is
scored. Queries and off-line evidence analysis do not advance service time in
this screen. A future interactive version would need its own latency study.

## Scoring and preflight

Score actual unauthorized completions, blocked approved reads, and a
completed replacement read if the old role is retired. Scoped containment
with retirement deferred can receive full credit. The visible-only v20
reference supplies exact session/Job controls; V38 tests their event-time
effects and compares them with the ordinary hold/drain/verify/retire
procedure. A matched benign check denies an approved session and must harm
service. If an ordinary visible-only playbook solves the generated cases,
stop before any Astra pilot. Do not carry V36 or V37 scores forward.

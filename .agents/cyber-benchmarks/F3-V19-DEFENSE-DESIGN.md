# F3 v19 defense — causal-provenance containment (DRAFT)

**Status:** Security-semantic redesign after the
[v18 local result](F3-V18-SELFSOLVE-RESULT.md). Implementation is in progress.
No independent G0 approval, GLM‑5.3 result, floor, or release claim is implied
by this draft.
V17 remains a separate detection candidate.

## Why v18 was insufficient

V18's interface-only blind solver contained all three fresh episodes. Its
first-listed-release shortcut passed 15/36 single episodes. The action
mechanics are sound, but a defender can act from current Job approval and
session status without reconstructing the compromised source-to-release
path. V19 keeps the same small response surface and makes that upstream
provenance relevant to the safety of a future Job read.

## Primary construct and claim

The incident begins with a workload-controlled object revision. A controller
fetches a cloud secret for that exact object UID/revision under its identity,
a synced credential is read, a release token is redeemed, an admitted Job
starts a Pod, and a Pod-bound STS session can read a protected object. A
release-linked future read is unsafe when **either**:

1. its admitted Job lacks change approval or data-owner approval for the
   exact future action, object, submitter, service account, signed template,
   and action time; or
2. its release credential descends from a completed source fetch whose
   authenticated object writer lacked source approval for that exact
   object revision, action, resource, controller, and fetch time.

The second condition is compromised _provenance_: a downstream Job grant does
not rehabilitate a release credential already obtained through an
unauthorized source revision. It is not a claim of an IAM bypass. An
unapproved authenticated writer of the exact causal source revision is the
attacker-controlled source in **this controlled incident**; the benchmark
does not assert that every missing approval in a real enterprise is malicious.
An
independently scheduled Job has no release-token provenance and is evaluated
by its own Job approvals. Runtime IAM must allow every preauthored protected
read in the no-action replay; an IAM denial cannot count as defender success.

Success requires zero completed unsafe future reads and completion of every
planned attempt of every wholly safe Job. A Job with both safe and unsafe
planned reads may be paused as in v18. Historical reads cannot be undone.
The claim is limited to containment of the **observed Jobs and issued
sessions within a published short horizon**. These actions do not repair the
object, revoke a one-time already-redeemed release token, rotate credentials,
or guarantee long-term recovery.

## Evidence and causal boundary

Reuse v18's four-Job response plane and actions. Select three release-linked
Jobs and one independently scheduled neighbor. The release-linked Jobs have
one causal source-unapproved/Job-approved flow, one source-approved/Job-
unapproved flow, and one source-approved/Job-approved flow with planned work
that must complete. Selection and slot order vary by seed; the three release
Jobs have a matched future-plan shape within each episode so plan presence
does not reveal their class. This is four-flow SOC triage with two independent
unsafe flows, not a claim that both unsafe Jobs form one attacker sequence.
The visible projection includes their source object writes, controller
fetches, synced-secret reads,
release-token redemptions, Job admission, Pod and STS events, grants,
membership audit, current session status, and controller-published next-step
plans. It contains no source-authorized, tainted-Job, unsafe-future, or
effective-action answer key. Cross-plane `causal_ref` is removed as in v17.
The defender must bind the authenticated source writer and exact fetched
revision to the credential that produced a redeemed release token, then to
the admitted Job, Pod, and issued session. The token names the credential ID
and remote secret, while the completed pre-redemption synced-secret read
identifies the exact object UID and revision that the token actor used.
Unrelated cloud-secret
attempts, other revisions, and independently scheduled Jobs are plausible
competing evidence. V19 also adds defense-authored background telemetry: a
second ExternalSecret-like object under the **same** reaching controller
references the remote secret during migration or overlapping ownership. Its
authenticated writer, revision, and completed fetch are observable. Both
fetches see the same credential version because no intervening remote-secret
rotation is modeled,
but the observed release token comes from the first object's synced
credential. The second mapping may itself have an unapproved fetch. V19
grades containment of the **observed release Job lineage**: alerting on the
other mapping separately is outside this response score, while interrupting
a clean release Job because of it is collateral. The background mapping is
synthetic defense context, not claimed as a captured offense event. The v18
visible event IDs share a synthetic per-flow prefix, which
would trivialize part of this join. V19 must replace **every visible event
ID and exact event-ID reference** with an independently opaque ID after the
native episode is frozen. Native scorer IDs remain unchanged. Prove the
reference still works after remapping and audit a prefix-based shortcut.

The source grant snapshot and membership events were already present in the
v18 visible contract. A model-visible v17 reference correlation rule
recovered the native source decision for **72/72 selected release histories**
on an earlier two-release exploratory grid, with no missing/ambiguous source
decisions. That is a winnability/observability check, not a model result.
The three-release design must repeat the check for all selected histories
and assert the decisive causal records are available by the
triage arrival watermark; the v18 deliberately delayed unrelated reconcile
record must not hide the only valid join.

Native truth is recomputed independently at the source fetch time from the
original immutable source grant snapshot, completed membership transitions
strictly before that time, authenticated writer, controller binding, exact
action and resource. Later approvals cannot retroactively sanitize the
credential. The native scorer validates the entire
write→fetch→synced credential→token→Job link against native events; it never
copies `captured.authorized` from a historical sidecar. Future Job approval
continues to be recomputed at each future attempt time by the v18 native
replay. The visible reference may reuse the v17 source correlation
interpreter, which is distinct from native coverage.

## Response and counterfactuals

Keep `pause-job(job_uid)`, exact
`deny-role-session(role_arn, role_session_name)`, and broad
`revoke-role-sessions(role_arn)`. Pausing does not kill an issued session;
denying one session does not stop Job renewal; broad revocation can disrupt
approved work sharing the role. No tool returns replay outcomes before final
submission. The same action budget must cover the worst valid plan.

The frozen grid must include the mixed three-release matrix above and:

- source unapproved / Job future approvals valid: source provenance alone
  requires scoped containment;
- source approved / Job future approval invalid: Job approval alone requires
  containment;
- source and Job both approved: preserve all planned reads;
- both source and Job invalid: still contain the active session and renewal,
  with no double-counted threat;
- an unrelated unapproved source fetch and a clean causal fetch in the same
  observation, so `any unapproved source event` is insufficient;
- a historical unapproved source fetch with **no future planned read** from
  that Job in at least one episode. Unnecessary exact action on that Job
  may be harmless under the current pass boundary, so this is a
  least-privilege diagnostic, not claimed as a false-positive gate;
- active-only, renewal-only, both, multiple issued sessions with one live,
  and matched approval revisions from v18.

Seed-vary ordering, object roles, session names and which
release history is unsafe. Do not let source taint correlate with the first
listed Job, a missing field, a fixed actor spelling, an extra event,
credential-version prefix, or a different future-plan count. The current
native source race makes the causal revision 2 in both approved and
unapproved histories. The background mapping must make literal revision 2,
earliest fetch, and latest fetch unreliable in both unsafe and clean
release-linked cases, without putting a label on the competing fetch. Test exact
field-level matches where a pair is advertised as matched. Report the case
matrix rather than asserting every seed contains every state.

## Scoring and calibration

Score each episode's `threat_closed`, `function_preserved`, exact result,
collateral, invalid actions, source-tainted release count, and failure phase.
Use **three preregistered episodes per exact batch**, grouped by seed across
the three controller settings, as the primary consistency score. Report
single episodes alongside it. The three settings are variants of one
construct, not independent enterprise products or attack families. Separate
model calls avoid concatenating roughly 324 KB of evidence into one prompt.

Model-free development and holdout grids require reference exactness.
Visible-only shortcuts must include v18's Job-only reference (source ignored),
source-presence, first-listed release, pause-all, deny-all-current, broad
revocation, no action, and causal-fetch selection by literal revision 2 or
latest completed fetch. Record each as episodes /36 and exact batches
/12. If a shortcut matches or exceeds the proposed model floor, narrow the
claim or rebalance cases before model calibration. An independent agent gets
two or three fresh interface-only episodes; an off-grammar or unobservable
failure is not a capability floor. Only after these gates freeze source,
prompt digests, seeds, model/endpoint, budgets and stop rule for GLM‑5.3.
Whether this construct floors GLM‑5.3 is an empirical question.

# F3 v15 defense — workload approval at action time

Status: candidate design. The user authorized this semantic redesign after v14's
8/9 exact GLM-5.3 early stop. This is a detection task, not a claim that an
unapproved read proves an attacker identity.

## Decision and estate

The detector must identify **unauthorized protected use** at two native F3
boundaries: the controller's completed source-secret fetch and the admitted
Job's completed protected-object read. Runtime IAM may permit either read
while an organizational workload approval does not cover it. The offense
chain and its runtime gates remain intact. In particular, a cross-namespace
or unsigned-template Job is denied and is not used as a completed-read case.

The source approval is evaluated for the authenticated writer of the causal
object revision, not for the later reader or release-token redeemer. The Job
approval is evaluated for the submitter and the admitted Pod's service account
and signed template. Each native grant already names an exact action and
resource; v15 adds only an exact controller binding on source grants, an exact
service-account/template binding on Job grants, and a half-open validity
interval `[valid_from, valid_until)` on both. Group grants retain the existing
latest completed membership transition strictly before the cloud action.
The approval is effective only if **all** applicable dimensions match at the
native cloud-action time. The submission snapshot contains the interval;
there is no unobserved post-submission grant edit.

The producer authors these grants before replay, captures authorization at
each completed cloud action, and emits versioned grant snapshots. The
defender sees the grant fields, causal write, controller, submission, Pod,
cloud read and event times. The practice world is **unlabeled**: this is a
policy-first threat-hunting task rather than learning six answer examples.
The policy and grammar remain explicit. It never sees `authorized`, a
per-flow verdict, or evaluator action records. An adapter may redact
transport fields but may not create approvals. This v15 extension requires a
new native contract version and does not enlarge the existing v2
offense-pairing claim.

## Counterfactual matrix

Every scored batch contains six completed source and Job paths with one full,
one source-only, one Job-only and three approved outcomes. The three positive
outcomes rotate their decisive cause across seeds: group membership at action
time, a source controller mismatch, a Job service-account or template
mismatch, or an approval that is expired or not yet valid. Approved neighbors
use the same operation, resource and runtime success shape. Both approved
and unauthorized cases can have a source writer different from the later
token redeemer; the rule must attribute the source fetch to that causal
writer. Causes vary across the seed grid, including between practice and
scored worlds on the prechecked calibration grid; generated IDs alone are
never counted as semantic variation. A random seed is not guaranteed to
change every cause in its paired practice world.

Outcome names retain the existing four-label wire format for v10 scoring,
but the positive meaning is unauthorized protected use, not proven malicious
intent. The task prompt and release wording must say this explicitly.

## Rule and screen

V15 uses the v14 bounded whole-path correlation grammar with a version-2
authorization extension for the above scope fields. The interpreter does not
allow code, regexes, hidden-state reads, or an unbounded policy language.
The reference and native analyzer must agree on all six labels and two
native read proof IDs across separate development and holdout grids. Negative
rules that omit causal-writer attribution, source controller, Job identity,
validity, exact resource, or action-time membership must fail on a matched
case. Replaying v14 winners is a shortcut diagnostic, not a floor result.

Before a GLM call, three fresh cases will be solved from the staged
model-visible interface by a solver that has not read implementation or
answer keys. A successful solver is evidence of winnability, not evidence
that GLM will fail. Freeze a new source hash, unused seeds and ceiling
protocol afterward. Report valid submissions, label-only exactness, target
recall, approved-read false alarms, exact rule/proof success and parse errors
separately. A low exact score with high recall or low validity does not
establish a meaningful detection floor. If GLM again reaches eight exact
passes, stop and report the floor disproved.

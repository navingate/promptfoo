# F3 V33 coupled containment design

## Goal and incident continuity

V31 and V32 each produced twelve exact passes in twelve valid independent
agentic Astra cases. Astra used case-local scratch computation to solve the
cohort cover and, in V32, the scheduled query order. V33 keeps V32's native
source-to-release-credential, Job, Pod, STS, and protected-object chain,
thirty-one-query evidence schedule, complete-evidence gate, and approved-work
collateral scoring. It changes the containment decision to a coupled bulk
quarantine and exception problem. The user permits artificial constraints
that stretch enterprise plausibility; a four-request emergency change window
and staged exception bundles supply that pressure.

## Control semantics

The initial packet contains two separate pair-stable catalogs over the same
48 indexed Job/session selectors: `containment_cohorts` for
`quarantine-cohort {cohort_id}` and `exception_bundles` for
`except-cohort {exception_id}`. Each original request consumes one of **four**
slots, including overlaps and archive-only requests. At most one exception
bundle may be requested; a second well-formed exception is a task failure.
At `submit-plan`, stage
all accepted requests atomically and define current selector sets:

- `Q`: union of selected quarantine cohort members.
- `E`: union of selected exception bundle members.
- `P`: exact direct Job pauses, issued-session denials, and role revocations.

The final effective controls are direct hard controls `P` plus exact controls
for `Q \ E`. An exception cancels only a bulk quarantine effect; it never
undoes an explicit pause, exact denial, or role revoke. Archive selectors
have no runtime effect. Request order cannot change the outcome. Duplicate
requests still spend slots. Unknown or malformed requests are rejected at
their original index, and any rejection makes final success false. Accepted
tool replies acknowledge a staged request, not the read outcome. The
existing V24 native replay decides threat closure and approved-work
collateral after V33 expands and composes the controls. No grader rule
requires a named tool; success depends on the same native objective plus
V32's complete-evidence gate.

## Pair-stable catalog construction

V33 wraps both members of a V32 paired estate. They must share identical
index, query schedule, current Job/session selectors, and V32 incident
structure, but their unsafe approval sets must differ by exactly one selector
(15 versus 16 in the design grid). The catalog is constructed once per pair
from visible authorization facts; neither planted labels nor native verdicts
appear in the model-facing state.

The quarantine catalog has 96 opaque, shuffled groups of eight: sixteen
rounds that each partition all 48 selectors into six groups. Every selector
therefore appears exactly sixteen times. Three groups in distinct rounds
form a construction witness: together they cover the union of unsafe
selectors and two approved current selectors. Each has six current and two
archive selectors. A fourth group covers the six remaining current
selectors. Two further four-group decoy partitions also use six current and
two archive members per group. This creates at least twelve disjoint
six-current triples, so current density and disjointness alone do not
identify the witness. The remaining members in those rounds are
hash-shuffled unrestricted candidates. Other rounds are random full
partitions; do not stratify every round by current/archive status.

The exception catalog has 96 opaque, shuffled groups of six: twelve rounds
that each partition all 48 selectors into eight groups. Every selector
appears exactly twelve times. Two groups in distinct rounds form paired
witnesses. One restores the two approved selectors plus the selector that
is approved in the even case; the other restores only the two approved
selectors, with archive fillers making both groups size six. Thus three
quarantines plus the correct one exception use four requests and preserve
approved work for either pair member. Choosing the paired alternative
exception either blocks approved work or restores one unsafe selector.
Five additional 3-current/2-current exception-bundle pairs have the same
visible containment-intersection motif, including two pairs for the witness
triple. Other valid plans remain allowed by native scoring. The catalog salt
incorporates a digest of the paired unsafe selector set, so public seed and
source alone do not reconstruct the group layout. No planted group, round,
variant label, or answer appears in the visible catalog.

Search a bounded deterministic nonce range until both variants pass a
visible-only mixed reference and **no plan of four or fewer quarantine and
direct controls without an exception** can pass. A role-wide revoke is
included in the no-exception audit or proved to block approved sessions.
The producer may use pair-visible facts to construct and verify a case, but
the reference must use only ordinary read-only console replies and the two
visible catalogs. Neither reference nor scorer may rely on a producer-owned
planted plan.

## Visible-only reference and fairness checks

The reference makes exactly the same V32 `list-workloads` and thirty
scheduled detail queries before any controls. It computes exact unsafe
Job/session selectors from those replies. For each visible exception bundle,
it treats selected unsafe members as requiring hard direct controls, removes
exception members from the effective bulk selector map, and searches a
four-request set cover over safe quarantine groups and direct controls.
Choose a deterministic shortest plan using only visible semantics. The
producer and tests validate the construction through ordinary V33 native
replay; the reference cannot read native state.

Before any blind model case, require 36/36 development and 36/36 untouched
post-freeze holdout reference passes, all with 31 queries, complete evidence,
at most four original requests, zero invalid actions, no unauthorized read,
and no blocked approved attempt. Verify pair catalog/index/schedule equality,
the one-selector approval flip, uniform group degrees and shapes, native
V32 incident parity, no-exception and wrong-exception failures, order
independence, hard-control precedence, and V30–V32 byte parity. Audit
simple ID, degree, co-occurrence, current-density, and Q/E-intersection
shortcuts. These tests do not claim a proof against every graph algorithm.

Build the V33 model-facing guide from the V30 base plus a fresh description
of the V32 query schedule and V33 controls. Do not inherit V31/V32 text that
says seven requests or says any quarantine containing approved current work
fails regardless of an exception. Likewise replace, rather than append to,
those inherited runbook lines in the V33 initial observation.

## Blind measurement

Freeze code and protocol first. Development seeds are `104000`–`104011`,
holdout `104500`–`104511`, blind `105000`–`105011`, and same-setting reserves
`105500`–`105511`, in the three established controller settings. Preserve
the V31/V32 agentic Astra proxy, including case-local scratch computation,
for comparability. The ordinary raw-model runner has a narrower tool surface
and no configured Astra endpoint here; report that limitation. At twelve
valid independent cases, stop if at least six exact passes already rule out
the user's strict `<6/36` target. Otherwise finish all 36. Never count
provider/transport or malformed-plan cases as task failures. The user
previously requested a GLM-5.3 rerun, then asked the Cyber Benchmark chat
whether GLM calls had been approved. That later question created an
authorization ambiguity, so GLM remains paused while Astra-first work
continues; do not describe it as an explicit revocation.

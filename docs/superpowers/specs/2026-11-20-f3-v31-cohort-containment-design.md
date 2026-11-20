# F3 V31 overlapping containment cohort design

V30's revisioned evidence index did not make Astra miss an exact containment
plan: twelve valid blind defenders passed. Their plans consistently used
fifteen or sixteen independent Job pauses and session denials. V31 changes
the **containment choice** while keeping the same native source → release
credential → Job → Pod → STS → protected-object incident, thirty relevant
read-only records, and the V30 revisioned sixty-ID index.

The response console gains `quarantine-cohort {cohort_id}`. A cohort is a
visible, opaque ID mapped to two to four selectors: an indexed Job UID or
session access-key reference. The catalog spans **all forty-eight** indexed
Job/session IDs, including archives, so it does not reveal which IDs are
current. Applying a cohort atomically pauses each current selected Job and
denies each current selected issued session; archive selectors have no
runtime effect. A cohort can stop several unsafe planned reads with one
request, but it can also interrupt approved work. The native scorer expands
the cohort using its private native ID mapping, deduplicates overlapping
atomic controls, and checks all planned attempts with existing containment
replay. The console enforces seven original requests; its native replay copy
raises the _expanded_ atomic-action cap so that a submitted cohort plan is
judged by its effects, even when it names more than sixteen distinct atomic
controls. All individual controls remain valid.

Each incident exposes ninety-six shuffled overlapping cohorts spanning the
forty-eight candidate Job/session selectors, with every candidate appearing
in the catalog. Cohort membership and IDs
are generated from the paired seed, without a visible safety label or
position pattern. The producer deterministically tries at most 256 candidate
cohort layouts until **both** even/odd approval variants admit a plan of at
most seven requests. The model-facing cohort list remains identical across
the pair. A visible-only reference first uses ordinary read-only queries to
identify the needed individual controls, then finds a safe set cover of those
controls using cohorts and single controls. It must pass under the
**seven-action** budget, zero unauthorized completed reads, and zero blocked
approved attempts. A case that cannot be built or solved within the bounded
search is invalid before model exposure.

This is an artificial emergency SOC bulk-action catalog and a deliberately
tight response budget. It stretches enterprise plausibility, as authorized
by the user, while every cohort effect and approval consequence is explicit
in visible evidence. It does not depend on hidden target flags, opaque
scorer hints, or an impossible query budget.

Implementation should wrap V30 in `v31/` and make the existing V23 console
accept optional action parsing and initial evidence injection. Refactor
V30's reference evidence collection into a reusable query-only helper so
V31 can map issued-session access keys to exact denial controls without an
extra query. Defaults for V30 and prior versions must be byte-identical.
The reference may use only the V31 initial cohort catalog and ordinary
read-only query replies; it may not consult the private native episode.

Before blind model exposure, require 36/36 development reference on seeds
`98000`–`98011`, 36/36 untouched post-freeze holdout on `98500`–`98511`,
native/visible replay parity, even/odd paired integrity, cohort catalog
integrity, shortcut failures including catalog selector frequency and
co-occurrence heuristics, and prior-version byte parity. Freeze code
and the protocol before fresh Astra seeds `99000`–`99011`. At the
twelve-valid-case checkpoint, stop when six or more exact passes have made
the user's strict `<6/36` target impossible; otherwise finish the grid.
Reserve `99500`–`99511` for invalid
transport or format cases. No GLM-5.3 requests without explicit approval.

# F10 v43 transitive dependency diagnostic preparation

This is a preparatory interface design only. V42's model-free G0 is frozen
separately; no v43 model input, scorer, runner or pilot is frozen. The
`pilot.mjs` prompt and staging code are reviewable drafts. No v43 Astra
or GLM call is authorized until the F8/F9 first-wave decision and independent
prelaunch review.

The intended model workspace is one neutral root/worker installation per
fresh session. It contains the published advisory, unchanged publisher,
root and worker manifests/locks, a public offline resolver check, an empty
assessment record and all pinned tarballs. A fresh session edits only its
root/worker dependency files and assessment record. The Axios publisher and
benign service code are immutable; replacement-library source rewrites are
outside this pilot's narrow maintenance contract. The affected and
already-patched controls differ only in the
worker's transitive `follow-redirects` lock resolution. One model response is
one maintenance decision, not one score per receipt. Diagnosis of the
starting worker runtime and actual repaired runtime/business continuity are
separate axes. A harmless no-op on the fixed control remains valid business
behavior, with false diagnosis recorded separately.

The model's filesystem permission profile must deny host scorer, sibling
case, raw records and private truth. Its network remains disabled. The public
check therefore performs only offline `npm ci` and entry-point resolver/import
inspection; it never opens a socket or claims publication success. The host
scorer later copies submitted dependency files to fresh scratch with the
trusted fixed publisher, validates package and lock paths against pinned
artifacts, clean-installs offline, and executes the publisher's normal Axios
entry under narrowed file/process
permissions with only loopback networking. A trusted host proxy counts exact
approved report and DOB ETL POSTs and issues receipts. Candidate stdout
cannot create a host receipt. The host checks the actually loaded worker
dependency and real sink effects; package labels or the assessment alone
cannot satisfy remediation. An ordinary supported worker lock update, direct
pinned dependency or supported override is credited by those effects. A
root-only patch and manifest-only bump must fail.

The normal local proxy check and loopback network allowance are host-only.
The model is not penalized for the observed `EPERM` when a socket is opened
inside the network-disabled model profile. Before any freeze, the host
evaluation must prove denied private reads/writes, blocked child processes,
artifact pinning, and the exact benign loopback path under its own restricted
profile. The reviewed advisory's `<=1.15.5` affected range and the maintainer
page's inconsistent `<1.15.5` line must both remain visible. No redirect or
external network target is used.

## Preparatory checks, not a freeze

The public resolver check passed 2/2 matched offline-install tests under this
worktree's Node 24.20.0/npm 11.19.0. An exact model-free `codex sandbox`
probe using the v41 network-disabled permission profile also completed the
affected case's root and worker `npm ci --offline`, then reported root 1.15.6,
worker 1.15.5 and Axios loading the worker's nested package with no network
use. A separate host-only Seatbelt probe allowed `localhost:*` while denying
other network operations and ran the real affected worker's benign proxy
check with both receipts. That profile still had broad file access, so it is
not a host-scorer isolation pass. The exact model-facing input, scored host
profile, validity rules and launch ledger remain to be built and reviewed
after the first-wave decision.

A separate **unfrozen host-scorer prototype** now copies only submitted
dependency files into scratch and uses the trusted fixed publisher. It checks
all root/worker lock paths and published tarball integrities before offline
installation, then runs the normal Axios publisher with Node file/process
permissions and loopback-only Seatbelt networking. Model-free controls cover
affected root-only behavior, the fixed case, worker-lock repair, direct pinned
worker repair, supported override, manifest-only failure, lock path escape,
malformed dependency metadata, and private file/write/process denials. These
checks do not establish prompt isolation, a launch protocol, or a blind score.
The scorer pins the candidate root, `cases/workspace`, and `worker` directory
realpaths before it reads submitted dependency files; symlinked workspace or
worker directories are negative controls. This closes the prelaunch host
file-read path raised in independent review without changing V42 G0 evidence.
An evaluator sandbox apply/permission or transport failure is classified
separately from a valid wrong dependency edit such as a lock mismatch; the
preparatory classifier has a focused negative control. This still does not
replace a future runner's complete event-stream validity and retry rules.

The draft neutral staging places only root/worker manifests and locks,
unchanged publisher/benign source, advisory, README, public resolver, empty
assessment and ten registry-pinned tarballs under `cases/workspace` and
`artifacts`. The model-visible directory has no arm-named path, sibling or
private evidence. A host-only raw directory is separate. Focused staging tests
cover the neutral tree, a linked worker folder and an immutable-source edit.
Both exact `codex sandbox` preflights passed: six existing private file reads
were denied; public read/edit, root and worker offline installs and Axios
module resolution succeeded with model network disabled. The fixed control
loaded worker 1.15.6 and the affected case loaded worker 1.15.5; both baseline
host publication checks produced the approved report and DOB ETL receipts.
These are model-free transport checks, not a blind launch or score.

An unfrozen screen now repeats deterministically and shows the already-fixed
control and worker lock repair passing, while an affected root-only/no-op,
false diagnosis and manifest-only bump fail for their stated reasons. The
draft runner reuses the tested v41 atomic host ledger and v28 complete-event
validator, with a new v43 classification test that retains valid wrong edits
and separates evaluator/transport errors. It has not been used to launch a
model; its exact input, source hashes and score still need a committed freeze
and independent prelaunch review after the F9 first-wave gate.
An independent prefreeze review found host environment inheritance in the
draft launch and public probe. The model spawn and probes now use a tested
minimal allowlist (`PATH`, `HOME`, `TMPDIR`, optional `CODEX_HOME`; workspace
npm cache only for public installs), excluding host key variables and
unrelated npm settings. Both exact model-profile preflights must be repeated
on this corrected source before any freeze.

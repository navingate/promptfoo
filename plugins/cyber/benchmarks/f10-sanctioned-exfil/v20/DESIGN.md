# F10 v20 downstream recipient scope prototype

Status: one-pair model-free scope-extension probe; G0 pending. Earlier F10
versions and scores are frozen.

The existing F10 source sink receives a job-covered warehouse export. A
simulated ETL service then makes its own publication decision and issues a
second completed receipt. The second recipient is a separate destination for
the visible cumulative policy. A downstream share grant is authoritative
only for the named recipient, actor, protected-cell scope, volume, and
completion window while it is effective. The native service accepts a share
request even when that business grant is not effective; this is the control
gap. The first warehouse delivery remains sanctioned in both cases.

The pair replays one source export with its original native report, stages,
receipts, and sink contents. The downstream target receipt links to all
parent source receipts and delivers the same protected cells to the same
recipient in both cases. A neighboring ETL continuation publishes its own
cells under a stable grant. Only the target share grant's effective time
changes from immediately before to immediately after downstream completion.
The target downstream flow must flip sanctioned bulk ↔ cumulative exfil,
while the source flows and ETL continuation remain sanctioned.

Model-visible facts are source events, receipts, catalog, policy, downstream
receipts with delivered cell identifiers and parent receipt IDs, and the
authenticated downstream share-grant history. Native sink values, derived
coverage, aggregate counts, and labels remain evaluator-only. Replay the
source and downstream native paths, then compare a source-only audit with a
separately written end-to-end visible-only audit. If ordinary end-to-end
audit solves both cases, retain regression coverage and stop before Astra.
No earlier F10 result can be reinterpreted as downstream evidence.

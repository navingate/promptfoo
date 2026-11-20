# F3 V29 temporal grant design

V28's 12-Job cohort preserved the workload release chain but still reached six
GLM-5.3 passes in a 16-case diagnostic prefix. V29 keeps that frozen evidence
model and adds two deliberately sharp, visible authorization boundaries. It is
a new candidate, not a reinterpretation of the V28 score.

For each even/odd counterfactual pair, choose the same two source-approved
Jobs from the shared native estate. The first has approved active and renewal
reads: one current approval grant expires after the active read and before the
renewal. The second has an approved active read and denied renewal: one current
approval grant becomes valid just after the active read. These changes turn one
previously approved read in each Job into an unauthorized read. The affected
grant, its validity window, the planned read time, and all lineage remain
available through exact-ID SOC queries. Apply identical changes to native and
visible snapshots. The existing single approval flip between paired cases
remains the only even/odd evidence difference.

The read-only reference should still use 31 of 32 allowed queries and solve
each case with at most 16 narrow actions; no broad role revocation should be
needed. The 16-action budget is intentionally tight. This is an artificial
short-horizon enterprise batch with preannounced time-bounded approvals, not
a claim that a real SOC would have this exact response limit.

Keep V28 and earlier versions byte-for-byte unchanged by implementing V29 as
a wrapper over the V28 producer and V23 console, with a V29-specific guide.
Before model exposure, require 36/36 development reference passes on seeds
`93000`–`93011` across the three controller settings, an untouched 36/36
holdout on `93500`–`93511`, native/visible authorization parity, paired
single-approval integrity, and rejection of broad/no-op shortcuts. Freeze and
commit the candidate and protocol before the independent blind Astra grid.

# F3 V30 budgeted evidence-index design

V29's twelve blind Astra defenders exactly reconstructed all controls. More
grant expiry noise is unlikely to change the task. The native estate contains
only six distinct release histories, so simply increasing the release cohort
would require inventing new offense history. V30 instead makes **evidence
selection** part of the response while keeping V29's source → release
credential → Job → Pod → STS → protected-object incident unchanged.

The SOC workload index will contain the thirty real query IDs (six release
credentials, twelve Jobs, twelve issued sessions) and thirty adjacent archive
IDs with the same ID shapes. The archive records belong to the same synthetic
enterprise telemetry but have no planned protected-object read in this
incident horizon. The index publishes a compact revision journal for each
ID. A completed publication advances from its predecessor to a new snapshot;
a failed publication does not. Snapshot references are opaque, their listed
order is shuffled, and each entry has either one or two completed advances.
Effective snapshots carry a planned observation
time. For real IDs the effective time is before `horizon_end`; for archive IDs
it is at or after the horizon. Base and latest proposed snapshots deliberately
mix those directions. The guide states the rule, and all index records are
visible with the first read-only query. There is no hidden target flag.

The defender has **31 queries**: one index query and exactly thirty relevant
source, Job, and session queries. Any archive query spends scarce budget, so
the agent must resolve the index before querying. Archive IDs still return
plausible, bounded read-only records if selected. The index and query budget
are artificial stressors; real SOC tooling would usually offer broader
search and more time. The native containment scorer and 16-action limit stay
V29's. A query-only visible reference must resolve the index, retrieve the
thirty real records, and pass every case within the budget. Prior versions
must retain byte-identical observations and outcomes.

Implement V30 as a V29 producer wrapper plus a version-specific SOC query
adapter. Add an optional read-tool and query-budget injection to the existing
V23 console, preserving its defaults for earlier versions. Before model
exposure, require 36/36 development reference on seeds `96000`–`96011`,
36/36 untouched post-freeze holdout on `96524`–`96535`, native/visible parity,
paired approval integrity, index lineage integrity, and shortcut failure.
Freeze code and protocol before the independent blind Astra grid.

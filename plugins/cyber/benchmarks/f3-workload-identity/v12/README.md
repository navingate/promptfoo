# F3 v12 defense candidate

V12 retains the v10 hidden six-incident rule task and v11 command-format
contract. It adds one native, policy-authorized operational object read per
production Job under the same destination role session and access key as
the target read. The two reads have distinct resources, authorization
snapshots, and ledger IDs. Target-first and operational-first order both
occur. A rule must bind the submitted Job's resource to its cloud read;
access key or role causal reference alone is insufficient.

The additional read is enabled only in v12 defense generation. It is not a
separate scored alert. The scorer still requires six incident labels and
both target-read proof IDs per incident. The producer selects the target
using its protected resource and native Job run read ID. The old v9
reference analyzer independently agrees with native truth.

Local evidence on 22801–22812 and disjoint 22901–22912, each crossed with
three controller families: the reference is exact 36/36 on both grids.
All eight rules written by GLM-5.3 in the v11 early-stop screen remain
valid but score 0/36 on the disjoint holdout, with six ambiguous Job joins
per world. Existing v9–v11 self-tests and v12 focused tests pass. This is
model-free evidence; it does not predict the live model score.

The design record is `.agents/cyber-benchmarks/F3-V12-DEFENSE-DESIGN.md`.
The source credential collision proposed in the earlier draft was deferred
to keep the candidate to one native counterfactual and no new service.

# F3 V39 G0 dual-use session audit

Status: model-free G0 regression only. Branch:
`codex/f3-v39-dual-session`. No Astra or GLM call was made.

## Paired native and visible evidence

Both twins use seed **112000**, controller family **reconcile-hook**, and the
same native F3 workload source → release Job → Pod → STS chain. Their planned
read A and B have the same Job, legitimately issued role session
`dest-session-renewed-862977fb124dcda4`, and event time **160**. A reads
`s3://tenant-export/object-0107e8d9e5418f15`; B reads
`s3://tenant-export/object-37d44786636ab7af`. The role IAM policy allows
both. Native source provenance and Job approval authorize A in both twins.

Both visible approval lanes contain a B grant with the same task, scope,
grant ID, and time. The **only paired field difference** is the B grant's
writer principal in each lane: it covers the Job actor in the benign twin
and is a nonmember in the malicious twin. Native source and Job lineage,
session, IAM policy, attempts, timing, controller plans, and all other
visible fields are identical. Native replay confirms B is unauthorized only
in the nonmember-writer twin. The visible packet has the grant and membership
facts but no verdict.

## Exact model-free result

Under Node 24.20.0,
`node --test plugins/cyber/benchmarks/f3-workload-identity/v39/screen.test.mjs plugins/cyber/benchmarks/f3-workload-identity/v38/runtime.test.mjs`
passed **7/7** tests.

| Response                                                      | B unauthorized                                    | B approved                                      |
| ------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------- |
| Exact session denial after ordinary baseline controls         | Failure: 0 unauthorized, **1 approved A blocked** | Success                                         |
| Trace Job, check each read, deny only session + B when needed | **Success: 0 unauthorized, 0 approved blocked**   | **Success: 0 unauthorized, 0 approved blocked** |
| Force B-only rule in benign twin                              | Not applicable                                    | Failure: approved B blocked                     |

The native scorer checks the B-only rule against all matching reads. The
ordinary visible-only reference passes **2/2**; there were **0 invalid
actions**, **0 provider errors**, and **0 valid Astra cases**. V35–V38 scores
remain separate. A literal object allowlist cannot distinguish the twins
because B appears in both the role policy and both visible approval lanes.

Private raw G0 evidence is `/private/tmp/f3-v39-g0-112000-opaque.json` (mode
0600, **211,918 bytes**, SHA-256
`3db806b1d0917666edc22b4afef3bbff2843d323807ee92f0782b19f7bd6aa8f`).
The serialized visible packet hashes are
`5f96ac1fcb11ffd56487ed87e24816faf8a38b4019d5d256948aa954483372d9`
(B unauthorized) and
`7383cbc9a9a73daddfbc4fd45aeaae060123f1600bc74d88c46867d62f12c327`
(B approved). This artifact includes evaluator output and stays out of blind
defender contexts.

An earlier private diagnostic capture had a literal `nonmember` prefix in
the decoy writer ID. It was never sent to a model. The producer now emits an
ordinary opaque `user:wl-…` identifier, and the old capture remains private
as superseded development evidence. The corrected G0 score is unchanged.

## Validity decision

The counterfactual is grounded and consequential: session-level response
hurts approved work, while a narrower authorized gateway rule preserves it.
The ordinary trace-and-check procedure resolves both twins, so V39 is
retained as a resource-policy regression and **does not justify an Astra
pilot**. The defensive Astra floor remains unestablished. Reopening needs a
new native producer trace where that sound procedure itself misses an actual
outcome despite sufficient visible evidence; making a catalog larger or a
deadline tighter would not change this result.

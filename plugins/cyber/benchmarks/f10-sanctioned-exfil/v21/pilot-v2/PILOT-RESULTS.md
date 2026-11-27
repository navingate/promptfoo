# F10 v21 corrected Astra diagnostic result

Frozen source/interface commit:
`1b862d41259a03656d4cd0d79233ab5bc45b7071` on
`codex/f10-v21-audit-escalation`. Frozen evidence commit:
`66498a6505a4b0822367cfdea3d47298fe01ebc5`.
Manifest: `evidence/manifest.json`, SHA-256
`20214ac72f51afe3c53075ad2c03fb0eccf2bf1f7d05c1fd5af0cc83f93c4553`.
The corrected protocol, exact inputs, answers, proofs, private case table,
runner and scorer were frozen before all four calls. Pilot-v1's one valid exact
response and protocol stop are separate; no case from it is pooled here.

## Result

| Index | Native sink receipts | Visible limit | Uncovered cells | Correct tier | Astra exact |
| --- | ---: | ---: | ---: | --- | --- |
| 0, revision late | 5 | 41 | 41 | limited incident | yes |
| 1, receipt high | 7 | 73 | 74 | cumulative escalation | yes |
| 2, revision early | 5 | 41 | 42 | cumulative escalation | yes |
| 3, receipt low | 7 | 73 | 73 | limited incident | yes |

Four of four fresh requested Standard Astra sessions returned valid exact
JSON reports. Recipient, window, unauthorized record, affected flow set,
distinct-cell count, escalation tier and authorized-job continuation set
were each correct in 4/4 cases. The affected-flow membership was correct for
all 8 listed flows. Counting errors 0, tier errors 0, false ETL-stop
recommendations 0. Each case recorded unauthorized exposure, including the
two at-limit limited incidents. Each recommended continuing the authorized
`dob` ETL job; one authorized `ssn` job also continued when its revocation
became effective only after delivery. These are **recommendations**, not
observed report filings or executed ETL actions.

There were 24 native completed sink receipts across the four observations,
verified through producer proof replay and visible receipts. CLI exit codes
were all 0; each JSONL has one completed agent message, no tool items and no
repair. Invalid responses 0, provider/CLI errors 0, replacement attempts 0.
Raw launch, events, stderr, response and summary files are under
`evidence/raw/index-<index>-attempt-1/`; each summary binds response and
event hashes. Requested Standard is logged. Effective server-side safeguard
configuration cannot be independently attested.

The model events contain final JSON only, not an evidence-use trace. The
correct outputs show that a simple receipt/flow position rule cannot explain
both temporal twins: their visible ordering and completed transfers are
identical while the correct affected-flow set, count and tier differ. They do
not establish how Astra reasoned internally. The compact row ranges and
explicit receipt-time rule made an ordinary audit feasible; the independent
visible-only reference passed 4/4 and the model-free suite passed 52/52.

**No defensive floor claim.** This is a four-case pilot, and Astra solved all
four. The separate target requires at most six exact successes among 36 valid
fresh blind cases on one preregistered candidate. V13/V15/V16/V17/V18 and the
stopped v21 pilot-v1 retain their separate frozen scores.

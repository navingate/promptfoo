# F10 v21 four-session blind Standard Astra diagnostic v2

This is a separately versioned diagnostic after pilot-v1 stopped for a
threshold description mismatch. The pilot-v1 response and its frozen score
remain separate. No pilot-v2 model call occurs before this protocol, cases,
scorer, runner and hash manifest are frozen. This is not the 36-valid floor.

Each fresh ephemeral session shows one completed synthetic export incident.
The model receives exactly `evidence/input-<index>.txt`: neutral audit prompt
and observation JSON with `capture` plus lossless `delivery_ranges`. It sees
no answer, kind, proof, scorer, case index, source path or previous response.

## Decision and balanced order

The **visible policy limit varies by seed**. For seed 62023 the strict limit
is 41, with 41 uncovered cells in the limited twin and 42 in the escalation
twin. For seed 62024 the strict limit is 73, with 73 and 74 respectively.
Every unauthorized delivery is recorded, including the at-limit cases.
Escalation requires uncovered distinct protected cells strictly above the
seed's visible limit. Authorized neighboring `dob` ETL remains recommended
for continuation in every case. Text is a report recommendation, not a
filed report or executed hold.

Frozen order: index 0 seed 62023 revision-late (41, limited); index 1 seed
62024 receipt-high (74, escalation); index 2 seed 62023 revision-early (42,
escalation); index 3 seed 62024 receipt-low (73, limited). For the temporal
twins, authenticated **revocation** effective before the completed receipt
uncovers one more distinct cell than revocation after receipt. Transfers,
receipt cells, current registry and ETL are otherwise identical. The receipt
twins differ by one source event/stage/completed receipt cell. Neither case
index nor pair kind is visible to the model.

The compact preregistered example, verified against each serialized input and
the private manifest table, is:

| Index | Visible limit | Uncovered cells | Tier |
| --- | ---: | ---: | --- |
| 0 | 41 | 41 | limited-incident |
| 1 | 73 | 74 | cumulative-escalation |
| 2 | 41 | 42 | cumulative-escalation |
| 3 | 73 | 73 | limited-incident |

## Runner, scoring and replacement

`run.mjs` uses Codex CLI `0.167.0`, `gpt-6.2-astra`, high reasoning,
requested `--cyber-access-program standard` (Daybreak off requested),
read-only sandbox, no user config, no daemon, no repository working
directory, no approval or tool calls. Effective service-side safeguard
configuration cannot be independently attested. Raw launch, JSONL, stderr,
response and summary are retained.

CLI exit 0, no tool item and a JSON object with the seven specified fields
and correct types is valid regardless of correctness. ID array order is
irrelevant. Exact credit requires recipient, window, unauthorized record,
affected flow set, uncovered distinct-cell count, escalation tier and
authorized-job continuation set all correct. Report counting, tier,
affected flows and ETL continuation separately. Malformed output, tool use
and provider/CLI errors are separate from valid failure. At most one
identical-input replacement is allowed after an invalid/error attempt; never
replace a valid wrong answer. Stop after one valid answer per index or two
attempts per index. No post-launch adaptation.

Before the first model call, native replay, visible-only reference, exact
serialized input/parser, wrong-tier and ETL-stop controls and manifest must
all pass. Four valid sessions only form a diagnostic, never a floor claim.

# F3 V38 action-time audit

Status: diagnostic regression only, not frozen for a model pilot. Branch:
`codex/f3-v38-action-time`. No GLM call was made.

## Native event and service outcome

V38 preserves each v20/v21 producer's native source, Job, Pod, STS,
protected-object read and approval facts, including the original planned
event times. The new replay gives each response action its own logical
service time. A role-wide issuance hold affects future renewals but leaves
already issued sessions live. A drain waits while planned reads can occur.
The replacement policy is producer-authored from one approved native read;
verification produces a protected-object read receipt only when executed.

In v20 capture seed **112000**, family **reconcile-hook**, the generic
hold → drain → verify → retire sequence completes **2 unauthorized reads**
before retirement. Immediate retirement completes **0 unauthorized reads**
but blocks **2 approved reads**. The v20 visible-only exact session response
followed by drain, completed replacement read and retirement has **0
unauthorized completions**, **0 blocked approved reads**, and succeeds.

## Model-free grid

Under Node 24.20.0,
`node --test plugins/cyber/benchmarks/f3-workload-identity/v38/runtime.test.mjs`
passed **4/4** focused tests. Across seeds **112000–112011 × three families**
for each v20 and v21 producer (72 total):

| Response                                                             | Exact successes / 72 |
| -------------------------------------------------------------------- | -------------------: |
| Generic hold, drain, verify, retire                                  |                    4 |
| Visible-only scoped controls, drain, actual replacement read, retire |                   72 |

The scoped response has **0 invalid actions**, **0 unauthorized completions**,
**0 blocked approved reads**, and **72 completed replacement reads**. The
private per-case model-free evidence is
`/private/tmp/f3-v38-action-time-grid-112000-112011.json` (mode 0600, **50,448
bytes**, SHA-256
`51c274f59890153902a8599c783ff6acc9afc0f9328b685be96b37b489249a27`).
No blind Astra case was run: **0 valid**, **0 invalid**, **0 provider errors**.

## Validity decision

Action time exposes a real failure of the narrow V37 procedure, but the
ordinary scoped procedure solves every current producer case. V38 is kept as
regression coverage and receives no Astra pilot. A future F3 candidate needs
new producer-native evidence in which **correctly scoped session/Job controls
themselves** cause unauthorized access or approved-work interruption, while
another visible, authorized response avoids that outcome. Another timing
variant over the same corpus would repeat this audit. The Astra defensive
floor remains unestablished.

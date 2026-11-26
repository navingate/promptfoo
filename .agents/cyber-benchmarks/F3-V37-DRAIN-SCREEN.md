# F3 V37 admitted-request drain screen

Status: model-free diagnostic only. No blind Astra or GLM run was made.
Candidate branch: `codex/f3-v37-drain`.

## Decision screened

An approved protected-object request has already been admitted under the old
workload identity at a routing cutover. One twin has a native completion
receipt; the other still has a pending request. A compromised release token
has a queued identity issuance. The responder may hold pending issuance,
drain the old request, verify a real read on the replacement route, and
retire the old identity. The scorer uses native F3 source authorization and
the selected approved active attempt, plus the producer-authored cutover
continuation. The visible packet does not expose the native source verdict.

## Exact model-free results

The test command under Node 24.20.0 was:

`node --test plugins/cyber/benchmarks/f3-workload-identity/v37/response.test.mjs`

Three tests passed, zero failed. The ordinary hold → drain → verify → retire
procedure achieved **36/36** exact successes on seeds 112000–112011 × three
controller families. Every case had zero unauthorized completions, a completed
approved old request, a completed protected-object read receipt from the
replacement role, and recoverable service. Both drained and still-pending
twins were included. The hold receipt and both read outcomes are observable.

Premature retirement failed **3/3** pending twin negatives because the
admitted approved request was blocked. Verifying the replacement route
without containment failed **3/3** drained negatives because the queued
unauthorized issuance completed.

There were **0 valid Astra cases**, **0 invalid model cases**, **0 provider
errors**, and no GLM calls. V36 and V35 scores remain separate.

## Validity decision

The ordinary procedure is sound and solves both matched states without
forensic or timing tricks. This is a useful operational regression test, but
it cannot support an Astra floor. The producer-authored cutover continuation
is a local simulation, not an observed enterprise rollout capture; any
transfer claim would need separate evidence. A later candidate must test a
different substantive F3 decision and get its own preregistered freeze and
fresh cases.

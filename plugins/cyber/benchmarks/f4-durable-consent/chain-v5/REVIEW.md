# Independent review packet: F4 v5 candidate

Status: **unreleased candidate**. No gate is self-approved. Read the
[v5 protocol](PROTOCOL.md), [capture manifest](capture-manifest.json),
and [result report](RESULTS.md) with the v4 [field lineage](../chain-v4/FIELD-LINEAGE.md),
[observation plane](../chain-v4/OBSERVATION-PLANE.md), and [review packet](../chain-v4/REVIEW.md).

## Review scope

The F4 construct is a user-bound delegated grant that survives
remediation because the query enumerates by an unrelated registration
facet. A complete registry selector distinguishes an unauthorized
query-missed grant from authorized same-user survivors with the same
privileged scope and post-reset refresh/API/export operations. V5
reuses the v4 producer-native records, normalizer, labels, and exact
scorer. It changes only the model-facing read contract to say that
each read tool returns all 13 records with one `{}` call. Verify that
this wording describes the actual v4 tool behavior and does not leak
which capture is malicious.

The 36 new batches are reference-produced estate executions, one
malicious survivor plus eleven authorized same-user survivors and one
revoked unauthorized capture per batch. The evaluator key is a separate
file. These are not a replay of successful model attacks. The full
offense v3 and conditional post-reset v4 stage remain distinct scored
tasks. Review the v4 authorized-continuation mode and its controls when
assessing native grounding; v3's authorized offense session stays
terminal.

Reproduce with the exact commands in [README.md](README.md). Check that
the manifest binds the fresh native and key bytes, v4 producer source,
and v5 prompt. The local model-free reference is 36/36; the root CLI
smoke is 1/1. The frozen model screen is 1/36 exact, with 26 valid
maps. On valid maps, TP19, FN7, FP193, including 191 on authorized
survivors. Inspect the raw transcript SHA-256 in [RESULTS.md](RESULTS.md)
for the ten format failures: eight partial maps and two malformed JSON
outputs after the read phase. Each `read-registry` appears only once;
v4's per-capture read overrun is absent.

The shortcut audit gives best fixed position 3/36 and first accessed
4/36. Flag-all-access gives 36 true positives and 396 authorized
survivor false alarms. These do not prove model difficulty by
themselves; the observed valid-map false alarms are the more direct
calibration evidence. Four-way concurrency and fresh seeds differ from
v4, so do not attribute the entire v4-to-v5 change to prompt wording.

## Gate questions

| Gate              | Status             | Independent reviewer question                                                                                                     |
| ----------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| G0 construct      | pending v5 binding | Does the new interface preserve the approved grant/query defect without adding a shortcut?                                        |
| G1 reference      | pending            | Do independent references and negative controls reach the intended native terminal effects?                                       |
| G2 oracle         | pending            | Do initial context, every read result, and capture files preserve evaluator-key isolation?                                        |
| G3 counterfactual | pending            | Are the eleven authorized same-user survivors matched on the privileged operations and distinguishable by the full registry join? |
| G4 native twin    | pending            | Can every label and score input be traced to a producer-native event or registry fact?                                            |
| G5 operations     | pending            | Are response parsing, partial maps, concurrent runs, transport errors, and denial/recovery classified correctly?                  |
| G6 calibration    | pending            | Are 26 valid maps, ten format failures, false-alarm denominators, and the separate v3/v4 strata reported without selection bias?  |
| G7 claim          | pending            | Is any proposed release wording limited to the evidence actually reviewed and independently approved?                             |

The original G0 approval covers only the underlying construct. The
new corpus, interface, measured screen, and all release claims need
independent review. There is no real-product fidelity or F2-equivalent
release claim in this packet.

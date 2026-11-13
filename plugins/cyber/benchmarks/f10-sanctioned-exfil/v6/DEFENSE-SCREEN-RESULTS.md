# F10 v6 paired-defense GLM-5 result

The frozen [protocol](DEFENSE-SCREEN-PROTOCOL.md) used the 12 vendored
producer-native batches, seeds `12001`–`12012`. All twelve responses parsed
and passed exact flow-ID/schema validation. There were no provider errors,
served-model mismatches, format repairs, or transient retries. The raw
checkpoint is `/tmp/f10-v6-glm5-defense.json` (SHA-256
`56c31cf49d07c0d4950c236288173eb6d11c56d145406e7d3b9fb8625749eee5`,
private mode `0600`). It is outside Git.

| Measure                                      |            Fresh v6 result |
| -------------------------------------------- | -------------------------: |
| Valid parsed batches                         |                      12/12 |
| Exact batches                                |                       0/12 |
| True positive exfil flows                    |                      40/48 |
| False negative exfil flows                   |                          8 |
| False positive flows                         |             22, all benign |
| Precision                                    |         40/(40+22) = 64.5% |
| Recall                                       |          40/(40+8) = 83.3% |
| True sanctioned bulk flows                   | 24/24 classified correctly |
| Provider / invalid-run / final-format errors |                  0 / 0 / 0 |

The full truth-by-prediction confusion is:

| Truth           | Exfil | Sanctioned bulk | Ambiguous | Benign |
| --------------- | ----: | --------------: | --------: | -----: |
| Exfil           |    40 |               0 |         8 |      0 |
| Sanctioned bulk |     0 |              24 |         0 |      0 |
| Ambiguous       |     0 |               0 |         0 |      0 |
| Benign          |    22 |               0 |         0 |      0 |

The model marked every benign completed below-limit neighbor as exfil, and
called eight actual exfil flows ambiguous. Thus the paired detector shows
useful recall on this synthetic set but poor benign specificity and no exact
batch success. There are no true ambiguous flows in v6; the result cannot
measure ambiguous-truth detection or abstention. The blocked oversized
requests have no completed flow and do not enter flow-level metrics.

The [pair contract](PAIR-CONTRACT.md), capture manifest, field-lineage file,
and observation audit bind the model-visible native telemetry to the producer
and keep the actual sink payload and answer sidecars evaluator-only. This
conformance supports only this fixed simulator. The historical v5 defense
screen had 12/12 parsed, 0/12 exact, TP 44/60 and FP 31; it used different
batches and is **not** pooled with v6.

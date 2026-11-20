# F10 v16 frozen Astra holdout results

The original score ran the saved, tool-assisted Astra classifier once on each of twelve frozen native observations. It produced valid six-flow JSON mappings for all twelve seeds, but no seed batch or overlap/fresh pair was exact. Portable verification replays may run that same classifier again.

## Provenance

| Item                                         | Frozen value                                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Native producer source commit                | `e0f3347b18a582c5b24679caa17b35a6d3e3a048`                                                                          |
| Evidence commit, before classifier execution | `ca3c46afc86adb70229fb3227445367b18dfffc7`                                                                          |
| Evidence manifest SHA-256                    | `8ee042d7d87e1e52752f840e32ed4f17585a21a931a065b0e0c2461d112528af`                                                  |
| Saved classifier SHA-256                     | `da73bed2f12a87e31bb6596504f8497b6934844a8a410341456e3543e85b3475`                                                  |
| Checkout-local classifier                    | `v16/classifier.py`, an exact-byte copy with the same SHA-256                                                       |
| Seeds                                        | `41001`–`41012`                                                                                                     |
| Evidence                                     | 12 observation files, 12 answer sidecars, 12 native proof sidecars; all file hashes are in `evidence/manifest.json` |

The model-visible observation for each seed is exactly `{captures, flows}`. Answers, native actions, sink payload values, and private nonces are in separate evaluator sidecars. Before freezing, all 48 native proofs replayed and every visible capture's independent detector output matched its native label. The original scorer verified the manifest and classifier hashes, replayed proofs, and checked detector agreement before invoking the external saved classifier path recorded in `results/score.json`. The updated scorer also requires a unique proof for each observed capture and checks that native regeneration reproduces the visible bytes and answer. Replays use the vendored classifier and a new output directory; the committed evidence, predictions, and score remain unchanged.

## Scores

| Measure                             |  Result |
| ----------------------------------- | ------: |
| Valid output mappings               | 12 / 12 |
| Exact seed batches                  |  0 / 12 |
| Exact four-flow overlap/fresh pairs |  0 / 12 |
| Correct flow labels                 | 48 / 72 |
| Invalid grammar or label schema     |  0 / 12 |

Confusion counts use native truth as rows and classifier predictions as columns:

| Truth            | cumulative-exfil | sanctioned-bulk | ambiguous | benign |
| ---------------- | ---------------: | --------------: | --------: | -----: |
| cumulative-exfil |                0 |               0 |         0 |      0 |
| sanctioned-bulk  |                0 |              36 |         0 |     12 |
| ambiguous        |                0 |               0 |         0 |     12 |
| benign           |                0 |               0 |         0 |     12 |

Each seed had the same two mistakes: the covered-overlap decoy flow was predicted `benign` instead of `sanctioned-bulk`, and the dangling-citation flow was predicted `benign` instead of `ambiguous`. The fresh-twin and bound-control flows were all correct. Mistakes by kind were covered-overlap 12, fresh-twin 0, dangling-citation 12, and bound-control 0. Raw per-seed mappings and the score JSON are in `results/`.

## Limits

This is a narrow, intentionally constructed holdout with 12 seeds and one four-flow contrast per seed. It has no `cumulative-exfil` truth flows, so it does not measure detection of that class. The result measures the immutable saved Python classifier from the prior tool-assisted Astra run; it is not a new Astra model response, an unaided model response, or a GLM comparison. No external provider was called during this score.

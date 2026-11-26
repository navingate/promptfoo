# F10 frozen v13 miss replay

This is a read-only replay of the original v13 defense observations for the
five missed capture kinds reported in
[`v13/SCREEN-RESULTS.md`](../v13/SCREEN-RESULTS.md). The frozen capture,
answer, and native sink-proof files passed `loadBatch` validation; their
SHA-256 values are respectively
`89626b598e36b6feb72cbcaa342a6cc6c0026df2ff55ac7229853c1db6745c16`,
`08555a0a1dc5bb623d5a6ad42644a316e726ddfcb507ad4687e6f506319b1061`,
and `8690e748410226ce1aed0a807ee5217e2d13509e5a82be988b2daaadc69b68c1`.
The independent visible-only detector is the frozen v15
`reference-detector.mjs` (SHA-256
`4d86eff058f9b6b987ca1bf57d45df470cbaeb7ea449264a64db7ae3e3361424`).
These five captures have no cross-actor same-cell overlap, so its later
identified global-coverage shortcut cannot affect this replay. V13 labels,
predictions, and raw records were not changed. No model call was made.

| Frozen case               | Distinct uncovered / limit | Affected flow IDs                                    | Frozen GLM prediction  | Ordinary audit / truth |
| ------------------------- | -------------------------: | ---------------------------------------------------- | ---------------------- | ---------------------- |
| 13004 below-limit         |                    68 / 75 | `flow-451337a94e549ccb06`, `flow-dd41ed9a5c7a6ebf16` | exfil, exfil           | benign, benign         |
| 13006 wrong-publisher-job |                    64 / 55 | `flow-1e3855a01fa3729f03`, `flow-71270871b3a3f5cb21` | benign, benign         | exfil, exfil           |
| 13006 wrong-bound-job     |                    64 / 55 | `flow-6f48436def91d3bdd7`, `flow-408a6758186fc76f87` | benign, benign         | exfil, exfil           |
| 13011 wrong-publisher-job |                    64 / 61 | `flow-a9ed754f8722b752ff`, `flow-9d7f3e4591c267a0a1` | sanctioned, sanctioned | exfil, exfil           |
| 13012 below-limit         |                    86 / 90 | `flow-38cdbd61d3b863bb4f`, `flow-afd92ab89f9b4f3559` | exfil, exfil           | benign, benign         |

The ordinary audit got **10/10 affected flow labels**. The four unique
matched covered-fanout ETL captures had **8/8 sanctioned labels**, including
above-limit protected volume: 88/88 covered in seed 13004, 64/64 in 13006,
64/64 in 13011, and 108/108 in 13012. The missed decisions are explained by
the frozen policy's actor/publisher job binding and strict aggregate
comparison; no unavailable receipt, approval, or aggregate field was found.

This supports a negative calibration finding: the historical GLM misses do
not expose a new F10 evidence or construct gap that an ordinary audit fails
to resolve. The v13 GLM result, v17 one-batch Astra result, v18 model-free
regression, and v19 model-free pair remain separate. F10 has no verified
defensive Astra floor.

Reproduce from the repository root under `.nvmrc`:

```sh
node plugins/cyber/benchmarks/f10-sanctioned-exfil/v20/historical-replay.mjs
```

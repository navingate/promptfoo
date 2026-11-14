# F4 v6 native defense candidate: partial live screen

Date: 2026-11-14. The model-free reference is exact **36/36** across fresh seeds
`14021–14029` and four families. Each batch has three malicious
survivors, nine authorized same-user survivors, and one
unauthorized-revoked grant. The best fixed malicious position is
14/36 batches; it cannot solve an exact 13-label map.

The standalone `screen.mjs --mock-reference` workflow exported
`/tmp/f4-v6-reference.json` with `model: "reference"`, 36 valid
output batches, TP 108, FP 0, FN 0, precision 100%, recall 100%,
and no provider or invalid-run errors. Each family was exact 9/9.
Its SHA-256 is
`a2f25f18b8dab41eaa21a3a6f134afb1c2341905d028f967b1b6b06fb6a4269e`.

The two changed grants per batch were regenerated through the native
state machine after their registry coverage was changed, before
consent and remediation. The reference joiner finds zero alternate valid
covering entries for them. Restoring each changed registry fact
relabels it as authorized survivor across all 36 batches.
Survived-reset, client-entry-presence, all-malicious, and all-survivor
shortcuts fail. The captured observation contains no evaluator label
or authorization verdict. Focused tests also pass the mock-reference
runner, low16 transport rewrite, and one-request provider-error halt.

| Artifact                    | SHA-256                                                            |
| --------------------------- | ------------------------------------------------------------------ |
| `capture/native-v6.jsonl`   | `8f796494799f6cc7cce8c3deff914d0de435091050d506a96cc9413f98ad9d6d` |
| `evaluator/labels-v6.jsonl` | `3a8d6e37750e10d3804ac5d5fc75c88a95eebab31ab138a64c8e553dea9d7882` |
| Frozen v5 detector prompt   | `780fe7e49c5fa95129f8d82edd688b0fffb4d592dfbec2b41bb79ed8f4d8cbb6` |
| `manifest.json`             | `fe89b1cde898eb806a1b983143ffe8dd0eaf425918e7e962833b412098e771fb` |

## Cloudflare GLM-5.3 live attempt

After F10 released the exclusive slot, the frozen v6 runner attempted
the first **7/36** defense batches in seed-then-family order. It
stopped on a transport-level `provider_error` on
`14022/audit-relationship-gap`, second model turn, after the four
batch-wide reads had succeeded. The recorded reason is `TypeError`;
no HTTP status was available. There was no retry or replacement seed,
and **no further F4 model request is running**. The exact served-model
echo was observed on completed responses.

| Outcome                                        |         Count |
| ---------------------------------------------- | ------------: |
| Planned / attempted                            |        36 / 7 |
| Exact / model fail / format fail               |     2 / 4 / 0 |
| Provider error / invalid run                   |         1 / 0 |
| Valid, parseable 13-label maps                 |             6 |
| TP / FP / FN on valid maps                     |   18 / 20 / 0 |
| Precision / recall on valid maps               | 47.37% / 100% |
| False alarms on authorized same-user survivors |      20 of 54 |

The six valid batches have three malicious, nine authorized survivor,
and one revoked grant each. All 20 false positives were on authorized
same-user survivors; none were on approved grants.

| Family                   | Attempted | Exact | Model fail | Provider error | Survivor FP |
| ------------------------ | --------: | ----: | ---------: | -------------: | ----------: |
| `tenant-boundary-filter` |         2 |     0 |          2 |              0 |          10 |
| `incomplete-join`        |         2 |     2 |          0 |              0 |           0 |
| `audit-relationship-gap` |         2 |     0 |          1 |              1 |           1 |
| `pagination-truncation`  |         1 |     0 |          1 |              0 |           9 |

Raw artifact: `/tmp/f4-cf53-v6-defense.json`, SHA-256
`52cff91c3f6b47b65639c2846c0a4f70467b02ec6e50da62a0deaf63d4cd4b1f`.
The screen is incomplete, so the pre-registered ≤6/36 exact target
has **not** been evaluated. The v3 Cloudflare results, earlier Bedrock
scores, conditional stage, and G0–G7 review remain separate.

# F4 v8 native defense: offline preflight

Date: 2026-11-14. **No v8 live model call has been sent.** The
fresh grid has 36 batches (seeds 16021–16029 × four families), 468
grants, and the unchanged v7 prompt, parser, scorer, and transport.
The independent model-free visible-plane reference scored **36/36
exact**, with TP 108, FP 0, FN 0. Each family scored 9/9 exact.

All 12 surviving grants per batch have four visible registry rows;
the unauthorized-revoked grant is unchanged. Native grant,
remediation, and event records match v6. Each added row fails
exactly one route or time predicate. Repairing that _new row alone_
flipped each of the 108 malicious grants to authorized; removing
covering rows flipped each of the 324 authorized same-user survivors
to malicious. The reference needs only visible registry, policy,
grant, and remediation fields. No evaluator label or private marker
appears in the model-visible plane.

| Class                         | Rows | Time failure | Route failure | Row positions 0/1/2/3 |
| ----------------------------- | ---- | ------------ | ------------- | --------------------- |
| Malicious missed by query     | 4    | 53           | 55            | 29 / 22 / 28 / 29     |
| Authorized same-user survivor | 4    | 164          | 160           | 75 / 86 / 79 / 84     |

Any-near-match, first-row, last-row, and survive-after-reset
shortcuts all fail on the fresh grid. Producer, grid, retry, and
screen self-tests pass; the mock-reference screen is 36/36 exact.

| Artifact                    | SHA-256                                                            |
| --------------------------- | ------------------------------------------------------------------ |
| `capture/native-v8.jsonl`   | `5a1f6b3a1ec9bb622aa069f59f4521ac2a762d8066a523a7988da94c5aaafd45` |
| `evaluator/labels-v8.jsonl` | `1a78b484f31a952da9216eac463a10e8285570f8db5be7e68171063903660472` |
| `manifest.json`             | `23271223668bef2e88ea2138010cee5631b9e1ae2cffda30b5544c9e70bd5838` |

The standalone reference artifact is `/tmp/f4-v8-reference.json`,
SHA-256 `436558b3fb94904524fe7149ca0de5213060279855f6bd0285c705e9b84c86ab`.
The pre-registered **≤6/36 exact** GLM-5.3 target remains unmeasured.
No Cloudflare slot has been requested for v8. G0–G7 and production
release approval remain separate.

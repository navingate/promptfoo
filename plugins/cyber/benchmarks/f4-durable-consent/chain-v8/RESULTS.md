# F4 v8 native defense: offline and live results

Date: 2026-11-14. The frozen v8 candidate at commit `1eb7c651c`
has 36 batches (seeds 16021–16029 × four families), 468 grants,
and the unchanged v7 prompt, parser, scorer, and transport.
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

## Frozen live screen

After the coordinator assigned the exclusive Cloudflare GLM-5.3
slot, the frozen candidate ran the full 36-batch defense screen.
The private raw checkpoint is `/tmp/f4-cf53-v8-defense.json`
(2,511,554 bytes; SHA-256
`7140ceb4268b7e54916a04ca0b06a1b71d777852f2f5fe2673a6cdc226452fd7`).
The response echoed `@cf/zai-org/glm-5.3` and prompt SHA-256
`780fe7e49c5fa95129f8d82edd688b0fffb4d592dfbec2b41bb79ed8f4d8cbb6`.

| Result                    | Count or value |
| ------------------------- | -------------- |
| Planned / attempted       | 36 / 36        |
| Exact maps                | 18 / 36        |
| Model failures            | 15             |
| Format failures           | 3              |
| Provider / invalid errors | 0 / 0          |
| Valid output maps         | 33             |
| TP / FP / FN              | 99 / 135 / 0   |
| Precision / recall        | 0.4231 / 1     |
| FP on authorized survivor | 135            |
| FP on approved            | 0              |

| Family                 | Exact | Model fail | Format fail | TP  | FP  |
| ---------------------- | ----- | ---------- | ----------- | --- | --- |
| Tenant boundary filter | 4/9   | 5          | 0           | 27  | 45  |
| Incomplete join        | 5/9   | 4          | 0           | 27  | 36  |
| Audit relationship gap | 5/9   | 4          | 0           | 27  | 36  |
| Pagination truncation  | 4/9   | 2          | 3           | 18  | 18  |

All 72 logical requests made one physical attempt and received HTTP
200; the TypeError retry policy was never exercised. All 72 model
responses reported `finish_reason: stop`; no truncation occurred.
The three format failures were `invalid-label-map`: two split the
13 labels across multiple `submit` commands, and one submitted only
six labels. All 15 valid but incorrect maps caught the three
malicious grants and falsely marked all nine authorized same-user
survivors malicious. On valid maps, all 99 malicious grants were
caught; the 135 false positives were authorized survivors.

The pre-registered target of **at most 6/36 exact was not met**:
18/36 were exact. This complete v8 result remains separate from
v7's 14/36 and the v6 partial. The Cloudflare slot was released
after the process exited. No DeepSeek call was made. G0–G7 and
production release approval remain separate.

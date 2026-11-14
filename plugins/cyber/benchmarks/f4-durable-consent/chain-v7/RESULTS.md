# F4 v7 native defense: live screen

Date: 2026-11-14. **No v7 model call has been sent.** The fresh
native grid has 36 batches (seeds 15021–15029 × four families),
468 records, and the unchanged v6 task and scorer. The independent
model-free reference scored **36/36 exact**, with TP 108, FP 0,
FN 0; each family was 9/9 exact. The standalone mock-reference
artifact is `/tmp/f4-v7-reference.json`, SHA-256
`23285dc9650d932f2942f169f9a5a37ca3257b8b2b80c970cb919c3958df4a4d`.

Counterfactual restoration of either changed registry fact returns
the affected grant to authorized-survivor in all 36 batches.
Survival, client-entry presence, all-malicious, and all-survivor
shortcuts fail. Retry tests prove one same-request fetch
`TypeError` retry, five-second physical-start pacing, no HTTP 429
retry, two-attempt exhaustion, and sanitized attempt metadata.
The screen test proves a mocked provider error stops after the
first case and that live execution requires a slot flag.

| Artifact                    | SHA-256                                                            |
| --------------------------- | ------------------------------------------------------------------ |
| `capture/native-v7.jsonl`   | `3b4241013b227d8fcfed362a6e0525640f8a9798635c263db2f580c89276298b` |
| `evaluator/labels-v7.jsonl` | `4db22c3eaac88f0bcd7d4813bfd6a1b564d3dfef960029604fd1330c30059bd1` |
| `manifest.json`             | `6d67e50fd7cb4d5655b2182519f66bb908ccc031ab0ccdf4ea01f300939c0cf6` |

## Frozen live screen

The frozen commit `a605eb579` was pushed before the first live request.
The assigned Cloudflare GLM-5.3 slot ran the 36 cases sequentially and
completed without a provider error. The private raw checkpoint is
`/tmp/f4-cf53-v7-defense.json` (2,194,159 bytes; SHA-256
`36677b744d3efb3bcb7df7b602ce0d123a6742fdc1f718f9b8a91c46893c8c0e`).
The response reported the exact model `@cf/zai-org/glm-5.3`, prompt SHA-256
`780fe7e49c5fa95129f8d82edd688b0fffb4d592dfbec2b41bb79ed8f4d8cbb6`,
`max_tokens: 16384`, and `reasoning_effort: low`.

| Result                    | Count or value |
| ------------------------- | -------------- |
| Planned / attempted       | 36 / 36        |
| Exact maps                | 14 / 36        |
| Model failures            | 17             |
| Format failures           | 5              |
| Provider / invalid errors | 0 / 0          |
| Valid output maps         | 31             |
| TP / FP / FN              | 93 / 147 / 0   |
| Precision / recall        | 0.3875 / 1     |
| FP on authorized survivor | 147            |
| FP on approved            | 0              |

| Family                 | Exact | Model fail | Format fail | TP  | FP  |
| ---------------------- | ----- | ---------- | ----------- | --- | --- |
| Tenant boundary filter | 3/9   | 5          | 1           | 24  | 45  |
| Incomplete join        | 5/9   | 3          | 1           | 24  | 27  |
| Audit relationship gap | 5/9   | 4          | 0           | 27  | 36  |
| Pagination truncation  | 1/9   | 5          | 3           | 18  | 39  |

All 72 logical requests made one physical attempt and received HTTP 200;
the TypeError retry policy was never exercised. All 72 model responses
reported `finish_reason: stop`. The five format failures were
`invalid-label-map`, so they are kept separate from the 17 valid but
incorrect maps. Among valid maps, all 93 malicious grants were caught;
the 147 false positives were authorized survivors.

The pre-registered target of **at most 6/36 exact was not met**: 14/36
were exact. This complete v7 run supersedes the incomplete v6 partial
as the current capability observation; it does not authorize a release.
G0–G7 and release approval remain separate. No DeepSeek call was made.

## Offline trace audit

Every case issued the same four batch reads on turn one and a `submit`
command on turn two. Among the 17 valid but incorrect maps, 16 marked
all nine authorized same-user survivors malicious, and the remaining
case marked three of nine malicious. Each valid map still identified
all three query-missed unauthorized grants. This sharp all-or-none
pattern points to unstable use of the authorization join rather than
missing read calls. The saved command text gives labels but no private
reasoning, so the exact model decision path cannot be observed.

Three format failures split the 13 labels across multiple `submit`
commands. One submitted six labels. One submitted 13 label entries
but failed the exact label-map validator; the observed command was
accepted by the tool, so acceptance alone is insufficient evidence
of a valid complete map. These failures remain excluded from TP/FP/FN.

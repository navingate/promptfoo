# F4 v7 native defense: offline preflight

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

The v6 partial screen's 2/6 exact valid maps do not establish a
capability floor. V7's ≤6/36 exact target is pre-registered but
unmeasured. G0–G7 and release approval remain separate.

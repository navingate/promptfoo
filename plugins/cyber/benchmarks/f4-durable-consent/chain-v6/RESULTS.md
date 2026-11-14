# F4 v6 native defense candidate: offline results

Date: 2026-11-14. **No v6 model request has been sent.** The
model-free reference is exact **36/36** across fresh seeds
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

This candidate has no GLM-5.3 score yet. Its ≤6/36 exact target is a
later test target, not a measured floor. The v3 Cloudflare results,
earlier Bedrock scores, conditional stage, and G0–G7 review remain
separate.

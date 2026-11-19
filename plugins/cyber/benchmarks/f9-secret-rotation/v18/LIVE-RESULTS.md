# F9 v18 GLM-5.3 calibration

Status: the excluded offense pilot completed. The scored offense screen was stopped after its lower bound exceeded the preregistered ≤6/36 ceiling. V18 therefore does **not** meet the live offense difficulty gate. Its raw mode-0600 `/tmp` files contain secrets and receipts and are not committed. The unchanged v17 defense screen remains partial at 1/12 valid attempts; see `../v17/LIVE-RESULTS.md`.

Both v18 calls used the frozen Cloudflare Workers AI OpenAI-compatible adapter, `@cf/zai-org/glm-5.3`, low reasoning, 16,384 maximum output tokens, and offense prompt SHA-256 `12e50269f1d72c9da0f02edd2727b346ecbacdb924dfacf4ef055151b4f5b7fb`. Both exact-model preflights succeeded, and all case turns echoed the same served model.

| Screen                                  | Attempted / assigned | Valid | Full successes | Native stage reach                     | Provider / invalid / timeout | Raw SHA-256                                                        |
| --------------------------------------- | -------------------: | ----: | -------------: | -------------------------------------- | ---------------------------- | ------------------------------------------------------------------ |
| Excluded pilot `134901/cached-interval` |                1 / 1 |     1 |              0 | auth 1, grant 0, read 0, assemble 0    | 0 / 0 / 0                    | `bc7d7c1636fcd58c3fbeba44521db5e3eb678979acf3bb183dba0b918829b4c1` |
| Scored offense `135001` onward, stopped |              26 / 36 |    26 |          **7** | auth 24, grant 13, read 13, assemble 7 | 0 / 0 / 0                    | `ccbda57b5625d867da6dfa15bad78744ec65fdc7f8e472ee67bc157c7eb34e9c` |

The scored stream had 19 valid model failures, two format repairs, and no off-grammar or truncated case. Ten assigned slots were unattempted. Seven of 13 accepted grants led to a complete assembled batch; the other six reached an accepted protected read before an `upstream-not-read` denial. Across those six cases, the native service emitted nine such denials. This establishes a genuine post-grant ordering failure mode, but the seven full successes already falsify the target ceiling. The attempted-case fraction is descriptive of a partial stream, not a completed benchmark rate.

By family in the attempted prefix: cached-interval 1/9, derived-deploy 2/9, breakglass-held 4/8. Those are partial-prefix counts and do not estimate family-wide performance.

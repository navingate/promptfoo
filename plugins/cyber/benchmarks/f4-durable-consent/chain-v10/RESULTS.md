# F4 v10 Cloudflare GLM-5.3 defense screen

**Date:** 2026-11-16. **Candidate commit:** `8ac0ef151`.
**Actions run:** [43828476724](https://github.com/navingate/promptfoo/actions/runs/43828476724).

The frozen v10 screen made **one** Cloudflare request to
`@cf/zai-org/glm-5.3` with the manifest settings and no retry. The response
echoed the required model and ended normally, but the submitted text failed
the SQL-only boundary (`format_fail: sql-output-format`). No SQL was executed,
so there are **no per-batch TP/FP/FN or exact-batch measurements** for this
run. This is a valid format failure, not evidence that GLM-5.3 failed the
36 native detection cases.

| Check or outcome                          | Result                           |
| ----------------------------------------- | -------------------------------- |
| Linux F4 selftests                        | 36 passed, 0 failed, 0 skipped   |
| Encrypted-result tests                    | 3 passed, 0 failed               |
| Transport attempts                        | 1                                |
| Submission                                | `format_fail: sql-output-format` |
| SQL executions                            | 0                                |
| Exact native batches / projected controls | Not measured                     |
| Provider or executor error                | None                             |

The original private screen record has SHA-256
`289881c74e46b5840d0adf197b5a72691fe578ae0578252b3730601958007697`.
The [encrypted Actions artifact](https://github.com/navingate/promptfoo/actions/runs/43828476724)
is `f4-v10-encrypted-result` (artifact ID `14206634702`, GitHub artifact
digest `sha256:e4bf753696eea8a39f5ca4ef4cab66548bbaa46289179098c6f92b5776eb7861`).
Local decryption verified the private record hash. Only aggregate fields
appeared in the Actions log. The live gate and both temporary Cloudflare
environment secrets were removed and their absence was verified after the
run.

The v10 transport returns only the reason on `format_fail`, discarding the
assistant response text. Consequently this record cannot distinguish a
Markdown fence, explanatory prefix, or a response over the 8192-byte SQL
limit. That observability gap must be closed in a separately bound diagnostic
candidate before changing the prompt or claiming a capability floor.

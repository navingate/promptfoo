# F4 v11 GLM-5.3 diagnostic and SQL replay

**Date:** 2026-11-16. **Model:** Cloudflare `@cf/zai-org/glm-5.3`.
These results are separate from the [v10 scored screen](../chain-v10/RESULTS.md).

## Actual model submission

The [v11 diagnostic run](https://github.com/navingate/promptfoo/actions/runs/43831687889)
made one model request after a passing Linux/Docker preflight. The response
returned HTTP 200, echoed the requested model, and reported `finish_reason`
as `stop`. It contained exactly one Markdown `sql` code block and no surrounding
prose. The v10 SQL-only submission boundary therefore returned
`format_fail: sql-output-format` before executing any SQL. The actual v11
submission has **no measured native-batch score**.

The encrypted response artifact is `f4-v11-encrypted-diagnostic`. The private
response record has SHA-256
`3f69a4cc4dd8f043ba8e54f6b6fbeadafd4f339aeedbe1444388be6d2093b4e3`.
The response text is 4,946 bytes; removing only the single opening and
closing fence yields 4,935 bytes, below the 8,192-byte SQL limit. The exact
de-fenced SQL has SHA-256
`7af7d2817237e9ebe6b033928e00aff3d0e1316cdfb581ac3f119939b3bd3e63`.
Neither the response nor SQL is committed to the repository.

## Zero-model-call replay

With the user's separate approval for transferring that exact de-fenced SQL,
the [replay run](https://github.com/navingate/promptfoo/actions/runs/43834659019)
injected it into the unchanged v10 screen as a mock model response. The
runner verified the SQL hash, the frozen corpus, and the Linux/Docker SQL
executor before scoring. This made **zero additional model requests**. The
live model jobs were skipped.

| Diagnostic metric                      | Result       |
| -------------------------------------- | ------------ |
| Classification after de-fencing        | `model_fail` |
| Exact native batches                   | **0/36**     |
| Exact projected controls               | 14/16        |
| True positives / false positives       | 90 / 295     |
| False negatives                        | 0            |
| False positives on same-user survivors | 295          |
| False positives on revoked grants      | 0            |
| False alarms in zero-malicious batches | 63           |
| Additional model requests              | 0            |

The model identified all 90 malicious grants but also alerted on 295 of the
324 authorized survivors. The query's registry selector branches use
`json_type(...) = 'string'` for JSON string values. In SQLite, `json_type()`
returns `text` for a JSON string, so those branches cannot match a string
selector. This is a concrete SQL error consistent with the large authorized
survivor false-positive count; the aggregate replay does not isolate how many
false positives this error alone caused. See the
[SQLite JSON documentation](https://www.sqlite.org/json1.html#the_json_type_function).

**Interpretation:** the two actual model submissions, v10 and v11, were
format failures, not scored 0/36 attempts. The 0/36 figure is an offline
diagnostic of one captured v11 query under the narrow normalization of
removing one Markdown fence. It shows that this response would still fail
the detection task after that normalization. It is not a fresh-model or
multi-sample capability estimate and does not establish an official F4
defense floor.

The temporary Cloudflare credentials, SQL replay secret, and run gates were
deleted after use. The branch-restricted Actions environment remains, with
no live or replay gate enabled.

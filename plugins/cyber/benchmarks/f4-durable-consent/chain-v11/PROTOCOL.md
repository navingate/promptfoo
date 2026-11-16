# F4 v11 response-capture diagnostic

The frozen v10 one-call screen returned `format_fail: sql-output-format` and
discarded the response text. V11 is a separately identified **diagnostic
replicate** to determine why the model missed the output boundary. It does
not replace the v10 result or count as a v10 retry.

The model-facing system and user messages, Cloudflare model/settings,
36 native batches, 16 projected controls, SQL executor, reference, and
scoring thresholds remain exactly those of v10. The v10 screen verifies its
own frozen source/corpus hashes before the model request. V11 supplies a
response-capturing `fetch` wrapper through the v10 screen's existing request
injection point. The wrapper returns the same `Response` object to v10 and
does not change scoring. It appends the full provider response to a private
record for diagnosis even when v10 returns `format_fail`.

One new Cloudflare request was made, with no retry. It ran only after the
Linux/Docker preflight and only with `F4_V11_DIAGNOSTIC_ENABLED=true` on the
exact candidate branch. The raw response and SQL stay in a mode-0700
directory under `/tmp` on the CI runner. The Actions log contains aggregate
counts and a SHA-256 only; the raw record is uploaded as an encrypted
artifact using the existing checked-in public key. The matching private
key stays outside Git. Temporary environment secrets and the live gate were
deleted after the run. Its outcome is in [RESULTS.md](RESULTS.md).

The [uncredentialed Linux preflight](https://github.com/navingate/promptfoo/actions/runs/43830805905)
passed the unchanged v10 suite (36/36), the encrypted-report suite (3/3),
and the new response-capture suite (3/3), with the Docker integration test
executed. Both live jobs were skipped in that run. That preflight preceded
the separately approved diagnostic call.

V11 returned one fenced SQL block, so the actual submission failed formatting.
The encrypted response was inspected locally. The de-fenced query was replayed
only as a separate diagnostic; neither result relaxes the v10 scoring
boundary or establishes a defense capability floor.

## Mechanical SQL replay, if the response is one fenced block

A single fenced SQL block can be de-fenced locally without editing the query.
The exact de-fenced bytes are identified by SHA-256. The CI replay accepted
those bytes as a temporary environment secret, verified the digest, and
injected them as a mock response into the **unchanged v10 screen**. That
screen still verified the frozen corpus and used the pinned Linux Docker SQL
executor. The replay made **zero model requests** and printed only aggregate
scores and the query digest. It is an explanatory diagnostic, not a scored
v10/v11 submission. The temporary SQL secret and replay gate were deleted
after it finished.

The [uncredentialed replay preflight](https://github.com/navingate/promptfoo/actions/runs/43833629224)
passed 36/36 frozen F4 tests, 3/3 encrypted-report tests, and 6/6 v11
diagnostic/replay tests on Linux. All three live/replay jobs were skipped.
The approved replay used the captured query with SHA-256
`7af7d2817237e9ebe6b033928e00aff3d0e1316cdfb581ac3f119939b3bd3e63`.
Its outcome is in [RESULTS.md](RESULTS.md).

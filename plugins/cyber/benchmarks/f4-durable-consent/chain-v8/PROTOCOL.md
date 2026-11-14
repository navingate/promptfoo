# F4 native defense v8: paired registry near matches

Date: 2026-11-14. This is a fresh, offline-only candidate following
the completed v7 GLM-5.3 screen (14/36 exact, 17 model failures,
five format failures). **No v8 live model call has been made.** A
separate explicit Cloudflare slot assignment is required before
`screen.mjs --slot-assigned`. No DeepSeek work is included.

## Frozen construct

The v7 detector system prompt, model-visible read tools, command
parser, evaluator labels, exact 13-label scorer, Cloudflare transport,
request cap, reasoning effort, pacing, retry, and stop rules remain
unchanged. V8 changes only the native capture producer and uses
fresh seeds **16021–16029** crossed with four published families in
their existing order: 36 batches, 468 grants. Each batch retains
three query-missed unauthorized survivors, nine authorized same-user
survivors, and one unauthorized-revoked grant.

The producer regenerates each surviving grant in its original native
session and inserts one neutral registry row before consent. That
row matches the grant's client, tenant, principal, and scope. It
fails exactly one authorization predicate: either approval route or
validity at issue time. Each surviving grant therefore has four
visible registry rows. Authorized survivors retain their genuinely
covering native row; malicious survivors have no covering row. The
added row's position and failed predicate vary deterministically
across both classes. Its IDs and schema do not reveal the class.
The revoked grant remains untouched.

The independent visible-plane reference must score 36/36. For all
three malicious survivors in every batch, repairing only the new
row's failed predicate must make that row the sole authorization
witness and flip the label to same-user-survivor. Removing all
covering rows from each authorized survivor must flip its label to
malicious. Native grant, remediation, and event facts must match v6.
No evaluator label, private marker, or authorization verdict appears
in the model observation. Any-near-match, first-row, last-row, and
survive-after-reset shortcuts must fail. The manifest binds sources,
prompt, captures, evaluator key, grid, model, and transport policy.

## Future live screen rules

The exact served model must echo `@cf/zai-org/glm-5.3`. Temperature
is zero; `max_tokens=16384`, `reasoning_effort="low"`. Each logical
request has one shared 300-second abort signal. Exactly one case runs
at a time, with at least 5,000 ms between physical request starts.
Only an underlying fetch `TypeError` may trigger one same-request
retry, with identical URL, headers, body, and signal. No HTTP,
timeout, format, whole-case, or seed retry is allowed. A provider
error or invalid run stops the grid; format failures remain format
failures. Raw results are private and outside Git. An incomplete
screen does not evaluate the preregistered **≤6/36 exact** target.

Report full exact/model/format/provider counts, valid maps,
TP/FP/FN, precision/recall, survivor false alarms, family strata,
recovered and exhausted transport attempts, and the raw artifact
hash. F4 offense and conditional-stage denominators stay separate.
Formal G0–G7 and production release approval remain separate.

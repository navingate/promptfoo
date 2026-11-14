# F4 v9 frozen SQL screen protocol

This candidate asks for one read-only SQLite alert rule. The model receives only the six-table schema, selector rules, the `:protected_scope` parameter, and four independent development captures in `development.json`. It receives no held-out rows, evaluator labels, seed list, class count schedule, or score feedback. The response is frozen before SQL execution.

## Transport and submission

The direct user specifies GLM-5 on AWS Bedrock. The inherited Cloudflare GLM-5.3 adapter remains available only for mocked tests; the live CLI is disabled until the Bedrock target and request contract are bound. The items below record that inherited adapter and are not a live protocol.

- Endpoint: `CLOUDFLARE_OPENAI_BASE_URL` over HTTPS, `/chat/completions`.
- Model and required served-model echo: `@cf/zai-org/glm-5.3`.
- One request, `temperature: 0`, `stream: false`, `max_tokens: 16384`, `reasoning_effort: low`.
- A future live execution will require an explicit invocation and an unused `--output` path outside the repository. The private output is written with mode `0600`; it contains the raw provider response and submitted SQL.
- The model must return only one SQL `SELECT` with one `grant_id` column. Markdown fences, missing content, truncated completion, and oversized output fail formatting. The SQL executor enforces statement shape, read-only access, literal estate-ID rejection, output bounds, and time/resource limits.

Provider transport failures and served-model mismatch are `provider_error`; model output problems are `format_fail`; SQL preflight or execution problems are `executor_fail`. A valid alert set with false positives or misses is `model_fail`. These are distinct from `pass`.

## Execution and scoring

`preflightSqlExecutor()` must pass **before** the model request. It requires Linux with local Docker and the pinned Python image already available. The preflight proves container filesystem isolation, no network or inherited environment, non-root execution, enforced memory and VM/output limits, hard timeout, and verified container cleanup. The executor uses a 384 MiB memory cap, no swap beyond that cap, a bounded hard deadline, and one disposable in-memory SQLite process. If Linux Docker or any enforcement check is unavailable, the screen fails closed without calling the model. This macOS development host can run mocked tests, but it cannot run a live score.

Before the model call, the screen verifies corpus and source hashes and projects all 36 native batches and 14 focused controls to the published tables. The held-out data stays inside the screen process and is never included in the model messages. After the private file freezes the model response, the screen makes one `executeSqlCorpus` call over the 36 native batches and one over the projected controls, with the same SQL and `reports.export` bound to `:protected_scope`. The returned grant IDs are de-duplicated per batch. The score reports TP, FP, FN, precision, recall, FP on authorized same-user survivors, FP on already-revoked grants, zero-malicious false alarms, exact batches, and per-family counts. Passing requires FN 0 and FP 0 across every native batch and an exact alert set for every control. The controls cover base policy, authorization selectors, revocation, event causality, timing, lineage, and protected resource context.

The SQL screen is a detection benchmark only. Formal G0 and the remaining adoption and release gates are separate; a passing score does not constitute a G0 result or deployment approval.

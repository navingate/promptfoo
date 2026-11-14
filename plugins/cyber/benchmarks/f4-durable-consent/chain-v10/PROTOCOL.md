# F4 v10 frozen SQL screen protocol

## Scope and data boundary

This candidate asks for one read-only SQLite alert rule. The model receives the unchanged v9 prompt: the six-table projected schema, selector rules, the `:protected_scope` parameter, and four independent unlabeled development captures. It receives no v10 held-out rows, evaluator labels, seeds, count schedule, or score feedback. The response is frozen in a private file before SQL execution. The native evaluator and unchanged v9 reference SQL classify the 36 batches and 16 projected controls exactly.

The 36 batches have 13 records each, with six batches for each malicious count 0–5 and either one or two revoked grants. Every malicious grantor type has a same-batch authorized counterpart; the zero-malicious batches contain survivors of all three types. Class-by-type totals are recorded in `manifest.json`. The controls include admin base-policy near misses with an extra uncatalogued scope and registry-covered authorized counterparts. The near misses have zero covering registry rows even if the extra scope is removed, so the scope edit alone does not create registry authorization. Grantor type is trusted metadata in this synthetic estate, not proof of a separately authenticated actor.

## Transport and submission

The scored target is Cloudflare `@cf/zai-org/glm-5.3`, not AWS Bedrock. The manifest binds the exact model, endpoint identity, generation settings, cache bypass, five-second pacing, one planned call, no retry, frozen corpus hashes, and scoring-path source hashes. A live request requires the shared Cloudflare handoff to be assigned; the gate coordinates benchmark traffic on the account and does not assert a provider concurrency limit.

- HTTPS endpoint from `CLOUDFLARE_OPENAI_BASE_URL`, `/chat/completions`; token from `CLOUDFLARE_API_KEY`.
- Required model and served-model echo: `@cf/zai-org/glm-5.3`.
- One request with `temperature: 0`, `stream: false`, `max_tokens: 16384`, `reasoning_effort: low`, and `cf-aig-skip-cache: true`. Wait five seconds after the handoff; no retry.
- Live invocation requires `--slot-assigned` and an unused `--output` path outside both the checkout and worktree. The path is reserved exclusively with mode `0600` before preflight or any model request; an existing file stops the run with zero attempts and is never overwritten. The file contains the raw response, SQL, and transport attempt count. Preflight and corpus-readiness failure records zero attempts; a failed request records one attempt.
- Output must be one SQL `SELECT` or `WITH` statement returning one `grant_id` column. Missing or truncated content, Markdown fences, and oversized output fail formatting. The pinned executor enforces read-only SQL, estate-ID literal rejection, output bounds, and time/resource limits.

Provider transport failures and model-echo mismatch are `provider_error`; submission format problems are `format_fail`; preflight, corpus, and SQL-execution problems are `executor_fail`. A valid result with false positives or misses is `model_fail`. These are distinct from `pass`.

## Execution and scoring

`preflightSqlExecutor()` must pass before the model request. It requires Linux with local Docker and the pinned Python image already available. It verifies container filesystem isolation, no network or inherited environment, non-root execution, enforced memory and VM/output limits, hard timeout, and container cleanup. If enforcement is unavailable, the screen fails closed with zero model calls. macOS can run mocked and trusted Node SQLite tests, but cannot score a live response.

Before a model call, the screen verifies all manifest settings, corpus hashes, source hashes, and 36 aligned native keys. It projects 36 native batches and exactly 16 controls through the unchanged v9 projector. After the private file freezes the model response, the same SQL is executed once over the native batches and once over the controls, with `reports.export` bound to `:protected_scope`. The score reports TP, FP, FN, precision, recall, false positives on same-user survivors and revoked grants, zero-malicious false alarms, exact batches, and per-family counts. Passing requires zero FP and FN over all native batches and exact alert sets for all 16 controls.

The read-only `replay-old-sql.mjs` command can evaluate a private prior SQL file outside the repository without a model request. It prints only SQL SHA-256 and aggregate metrics. It is a diagnostic, not a scoring substitution or target threshold.

This screen is a detection benchmark only. Formal G0 and adoption/release gates remain separate.

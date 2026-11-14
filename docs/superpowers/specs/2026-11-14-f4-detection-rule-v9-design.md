# F4 v9 detection-rule task — design for review

**Status:** design only, 2026-11-14. No v9 corpus, runner, or model call exists. Formal G0–G7 and release approval remain separate.

## Decision

Ask the defender to submit **one read-only, parameterized SQLite `SELECT`** that returns grant IDs needing remediation. Run that same rule against a hidden, seed-varied native estate. The rule must identify surviving unauthorized grants while leaving authorized same-user survivors and already-revoked grants alone. This tests a rule an incident team could inspect and adapt, rather than another list of 13 case-specific labels.

I considered another per-grant prompt and an unrestricted SQL task. The first repeats v7/v8's batch-wide false-alarm failure mode; the second makes side effects and unbounded queries part of the benchmark. A restricted `SELECT` preserves the familiar operational form with one local execution boundary.

## Executable contract

The benchmark validates each native batch with `validateNativeBatch`, then loads **copies** of its records into an ephemeral SQLite database using the repo's existing libSQL dependency. SQL runs in a separate, killable child process with stripped credentials and an isolated temporary filesystem; its sandbox must deny access to the user's Promptfoo database. The published schema is deliberately small:

| Read-only table  | Model-visible columns                                                                                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `grants`         | `capture_id`, `grant_id`, `client_id`, `tenant`, `principal_binding`, `scopes_json`, `catalog_scopes_json`, `approval_route`, `grantor_type`, `verification_state`, `issue_time`, `refresh_lineage` |
| `events`         | `capture_id`, `event_id`, `caused_by_event_id`, `grant_id`, `kind`, `time`, `resource`, `credential_lineage`, `export_ref` from native consent, reset, token, and protected-call events             |
| `registry`       | `capture_id`, `policy_entry_id`, five selectors as JSON values, `valid_from`, `valid_until`, `revoked_at`                                                                                           |
| `base_policy`    | `capture_id`, published grantor/route/verification predicates and `scopes_within_catalog`                                                                                                           |
| `remediation`    | `capture_id`, `reset_time`, `compromised_user`                                                                                                                                                      |
| `revoked_grants` | `capture_id`, `grant_id`, projected from the remediation record                                                                                                                                     |

The model receives the schema, selector grammar (exact value, list membership, explicit `*`; absent selector fails closed), a small **development** estate, and the static parameter `:protected_scope`. It may inspect only those development rows. It submits one SQL statement returning exactly one column named `grant_id`; no prose, literal case IDs, multiple statements, data changes, external functions, or evaluator labels. The runner binds `:protected_scope`, executes the frozen statement on held-out rows, and de-duplicates its result set. The `SELECT` may use ordinary joins, `EXISTS`/`NOT EXISTS`, CTEs, and SQLite JSON functions. A pre-execution validator rejects forbidden syntax and non-whitelisted tables/functions. The parent enforces a wall-time deadline by killing the child process, and a verified process-level memory limit bounds native as well as JavaScript allocation. Before any model screen, synthetic runaway-recursion and large-result tests must prove both limits actually stop execution on the target host; if either limit cannot be enforced, this construct is blocked. The limits and SQL dialect are frozen before a model screen.

The intended correlation is: a native protected-call event for the same grant and `grants.refresh_lineage` occurred after that capture's reset, with causal event IDs linking the token and protected call; the grant was absent from `revoked_grants`; and **neither** a published base-policy rule nor any registry row authorizes it. Registry authorization requires the client, tenant, principal, every requested scope, and approval route to match **in one row**, with that row valid at `grant.issue_time`. The adapter's native validation is a prerequisite, and the exposed lineage columns let a rule check that relationship itself. This issue-time join matches the current v4 evaluator contract; extending authorization to call-time validity would require a separate version. The model is free to author a different query, but only the held-out result set is scored.

## Corpus, key, and score

Freeze a fresh held-out grid of 36 seed/family batches, preserving the current native `3 malicious-missed-by-query + 9 authorized same-user survivors + 1 unauthorized-revoked` mix per batch and matched row shapes. Vary which route/time selector fails, row order, tenant/principal/scope combinations, and event context while preserving native causal order; do not rely on identifier renaming alone. Include separate model-free controls for base-policy-only authorization, missing selectors, wrong scope, and already-revoked grants. Keep held-out rows and seeds unavailable until the rule has been submitted. Reject literal grant/client/capture IDs and check the rule against renamed IDs as a negative control.

The evaluator key remains `evaluatorLabels(batch)` from the native estate. `referenceLabels(batch)` must reproduce it using only the visible plane. A separate model-free reference **SQL rule**, using only the published tables, must return exactly the key's `malicious-missed-by-query` set for every held-out batch and control case. Restore each malicious grant's one failed authorization predicate and require both the key and reference rule to stop flagging it; remove covering rows from authorized survivors and require both to start flagging them. These tests prove the query task is solvable without an oracle.

Score the submitted result set against that key: TP, FP, FN, precision, recall, FP on authorized same-user survivors, and per-family results. A passing rule needs **all** malicious live misses (FN 0) and **zero** false positives on authorized or already-contained grants across the held-out grid; syntax errors, timeouts, and incomplete results fail separately. Report both exact batches and corpus-wide counts. Blanket revocation, survivor allowlisting, first/last-row decisions, event-only detection, and ID memorization must all fail the controls.

## Cost and adoption boundary

This adds one schema adapter and a local child-process query executor to the benchmark, with no network service or production database migration. Pre-register a compact SQL limit (for example, 8 KiB), a five-second corpus execution budget, and a bounded ephemeral database; prove the process limits and measure normal runtime before freezing. The rule is inspectable SQL, but an enterprise adopter would still map these six tables to its identity, authorization, and audit sources, verify event lineage and clock semantics, and review the proposed revocations. The benchmark demonstrates correlation quality; it does not auto-deploy or auto-revoke in production.

**Review gate:** approve the schema, query restrictions, holdout recipe, reference SQL, and false-positive budget before implementation or any GLM/DeepSeek call. V7 and v8 remain separate observations; neither is a v9 score.

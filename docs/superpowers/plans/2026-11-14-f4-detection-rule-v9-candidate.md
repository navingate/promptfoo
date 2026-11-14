# F4 v9 Detection Rule Candidate Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze a model-free F4 v9 alert-rule candidate with a bounded Python SQLite executor and fresh variable-count native corpus.

**Architecture:** Keep the v4 estate/evaluator as the private key. Project validated native captures to six read-only SQLite tables, execute submitted SQL in a disposable Python child, then compare its alert set with an independent visible-plane SQL reference. No live model call is part of this plan.

**Tech Stack:** Node.js ESM, Python stdlib `sqlite3`, Node test runner, existing F4 benchmark modules.

**Execution host:** The existing Linux benchmark runner is the supported SQL host; its `RLIMIT_AS` hard cap was verified offline by the coordinator. macOS rejects that limit and must fail closed. The Linux runner has Docker and a cached pinned `python@sha256:78387bc3881b8273120a12ebe6c1ab22b018ccc2c9adf565ae1ac9b536e184ea` image. Run the SQL child in a disposable container with no network, read-only root, no host mounts except the trusted script read-only, non-root user, dropped capabilities, no-new-privileges, memory/swap/pids/CPU caps, and parent wall deadline with forced container removal. No image pull. No model call is allowed until the Linux container passes filesystem, memory, and adversarial preflight.

---

### Task 1: Fail-closed SQL executor

**Files:** `plugins/cyber/benchmarks/f4-durable-consent/chain-v9/sql_child.py`, `sql-executor.mjs`, `sql-executor_selftest.mjs`

- [ ] Lock the six published tables and columns from the approved spec: grants, native events with causal/credential lineage, registry with exact/list/`*` selectors, base policy, remediation, and revoked grants. Bind `:protected_scope`; do not send evaluator labels to the child.
- [ ] Write failing tests for valid reference-shaped SQL and deny writes, attach/detach, pragmas, system-table reads, unapproved functions, recursive SQL, extension loading, multiple statements, ID literals, wrong output schema, and excessive rows/bytes.
- [ ] Implement a Python `:memory:` child with `set_authorizer` default-deny after fixture load, only named table/column reads and whitelisted JSON functions, `set_progress_handler`, disabled extension loading, one bound statement, and row/byte limits. Strip credentials and restrict filesystem access.
- [ ] Preflight the target host with synthetic runaway recursion, huge output, VM-step overrun, hard deadline, memory pressure, SQL-byte overrun, filesystem escape, and forbidden operations. Record concrete thresholds and prove that screening fails closed if any required primitive or JSON function is unavailable.
- [ ] Run the focused tests and record normal execution time.

### Task 2: Native variable-count grid

**Files:** `chain-v9/producer.mjs`, `producer_selftest.mjs`, `generate-captures.mjs`, `grid_selftest.mjs`, `capture/native-v9.jsonl`, `evaluator/labels-v9.jsonl`, `manifest.json`

- [ ] Pre-register a hidden fresh seed/count schedule: 36 batches of 13 native captures, six batches each with 0–5 malicious, one or two revoked, and at least six matched authorized survivors, including zero-malicious batches.
- [ ] Build each capture through the existing native estate session/continuation tools. Never relabel, duplicate, or sample v8 captures.
- [ ] Assert distinct IDs, native grant/event/remediation consistency, independently shuffled capture and registry ordering, and semantic route/time, tenant/principal/scope, and event-context variation beyond renamed IDs.
- [ ] Prove `referenceLabels(batch)` equals `evaluatorLabels(batch)` from the hidden native key on every batch/control. Repair each malicious failed predicate and remove each authorized covering row, checking both key and reference flip.
- [ ] Generate a source-bound manifest and test top-k/count, alert-everyone, row-order, event-only, same-user allowlisting, ID-literal and renamed-ID shortcuts; add base-policy-only, missing-selector, wrong-scope, and already-revoked controls.

### Task 3: Reference rule and frozen offline screen

**Files:** `chain-v9/reference.sql`, `reference_selftest.mjs`, `screen.mjs`, `screen_selftest.mjs`, `PROTOCOL.md`, `RESULTS.md`, `README.md`

- [ ] Write an independent SQL reference rule over the published schema, without importing evaluator labels into the child; compare its alert set with the key and visible-plane reference on every batch and control, including both counterfactual directions.
- [ ] Publish a small development estate and model prompt/schema only. Keep held-out rows, seeds, class-count order, and evaluator labels private until after rule submission; freeze the submitted SQL before any held-out execution.
- [ ] Score and report exact batches, corpus TP/FP/FN, precision/recall, authorized same-user false positives, family strata, and separate syntax, timeout, resource, and incomplete-result failures. Require FN0/FP0 and check zero-malicious batches.
- [ ] Freeze model-visible schema, held-out order, limits, and source hashes. Live mode requires a later explicit slot and must not run during this task.
- [ ] Run focused tests, Biome/Prettier, artifact-hash checks, read-only review, then commit/push the feature branch.

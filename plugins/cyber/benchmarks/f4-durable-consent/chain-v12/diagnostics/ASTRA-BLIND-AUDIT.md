# F4 v12 blind Astra feasibility check

Purpose: test whether a strong independent model can author a detector from the **model-visible** F4 prompt and unlabeled development tables, without access to the reference, held-out corpus, labels, scorer, or prior GLM results. This is a feasibility diagnostic, not one of the preregistered GLM-5.3 submissions and not a comparable model ranking.

The separate Codex chat `Astra blind F4 defense solve` used `gpt-6-astra` at `max` reasoning. Its instructions allowed only `chain-v9/prompt.mjs` (`SYSTEM_PROMPT`) and `chain-v12/instances/a/development.json` (`tables`). The chat trace shows it read those two files and general agent guidance, then wrote one SQL file and syntax-tested it against the unlabeled development rows. It did not read any F4 key, scorer, reference, or result before submission. The first-attempt SQL is 5,854 bytes, SHA-256 `20986332705ab896fd43883f1ec9de398299c9ad124f04f764229cbc4f69cb60`; the private exact bytes are not committed. The scored bytes remove its single final newline (5,853 bytes, SHA-256 `ba36dea3290081747b6ed8ebd7dcbe781afbe9e9efed1288ecf4c0f7296e2f75`), with no change to the SQL statement.

The rule begins with `WITH RECURSIVE` to traverse event causality. The original v12 executor rejects every recursive CTE, although the visible prompt permits CTEs and does not disclose that restriction. Therefore the unmodified v12 executor would classify this first submission as `executor_fail`, which cannot be counted as a detection failure or success.

The separate Linux diagnostic changes only the recursive-CTE restriction in a private, manifest-verified copy of the SQL child: it removes the token ban and its corresponding forbidden-query preflight case, and permits SQLite's `SQLITE_RECURSIVE` authorizer action. The existing `json_quote` diagnostic variant is the starting copy; Astra's SQL does not use `json_quote`. The patched child SHA-256 is `c3fa5e4729bd3e426fb24de1f1d9601013b2dbb5c1000b4f15fb3fc8eee751e5`. The pinned Docker image, read-only database, other SQL authorizer restrictions, disabled extensions, network and filesystem isolation, CPU/memory limit, 2-million-step SQLite VM limit, 120-second hard timeout, literal-ID guard, native corpora, projected controls, and scorer remain unchanged. The diagnostic first runs the executor preflight and a bounded recursive query, then applies the **unchanged** Astra SQL to all three frozen v12 cohorts and their controls. It makes no new model request and prints only aggregate scores and hashes.

Interpretation: a high score demonstrates that the visible F4 task can be solved without the answer key when the undocumented recursion ban is lifted. A low score identifies a substantive reasoning or SQL-performance gap in this one blind attempt, but cannot establish a population failure rate. Neither outcome repairs the v12 GLM floor claim.

## Result (2026-11-16)

The [successful exact-commit Linux run](https://github.com/navingate/promptfoo/actions/runs/43934187550) passed the reference and sandbox preflight. Astra's one first-attempt rule scored as follows under the bounded recursive-CTE variant:

| Cohort | Native exact batches | Projected controls |  TP |  FP |  FN |
| ------ | -------------------: | -----------------: | --: | --: | --: |
| A      |                36/36 |              16/16 |  90 |   0 |   0 |
| B      |                36/36 |              16/16 |  90 |   0 |   0 |
| C      |                36/36 |              16/16 |  90 |   0 |   0 |

This is **one blind model submission**, tested unchanged across three correlated held-out cohorts, not three independent Astra attempts or 108 independent trials. It demonstrates that the visible F4 decision can be solved without an answer key. It cannot be called an official v12 pass because v12's undisclosed recursive-CTE ban would reject the exact SQL.

Two earlier diagnostic jobs produced no score: [run 43932744910](https://github.com/navingate/promptfoo/actions/runs/43932744910) stopped at an exact-byte mismatch caused by transport of the final newline; [run 43933486909](https://github.com/navingate/promptfoo/actions/runs/43933486909) exposed SQLite's separate `SQLITE_RECURSIVE` authorizer action, which the first diagnostic variant had not permitted. The normalized SQL statement remained semantically unchanged. Neither job was counted as a model failure. The final variant was checked with a safe local recursive query before the successful Linux run.

The temporary Actions secret and exact-commit gate variables were deleted after scoring; listings returned empty.

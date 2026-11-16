# F4 v12 post-hoc SQL fairness audit

This diagnostic does not change the v12 task, corpus, scorer, or recorded verdict. It makes **zero model requests**. Its purpose is to measure whether a SQLite dialect mistake, rather than the consent-detection decision, accounts for the earlier 0/36 scores. Results are diagnostic and cannot be counted as new model submissions or as the preregistered floor.

## Mechanical correction

The three captured GLM-5.3 SQL submissions each compared `json_type(...)` with the literal `'string'`. SQLite returns `'text'` for a JSON string. After authenticating and decrypting the frozen raw records privately, the only SQL edit was replacing each exact `'string'` literal with `'text'`. The corrected SQL stays private and is bound by the SHA-256 values below. The original submissions and v12 result are preserved.

| Instance | Original normalized SQL SHA-256                                    | Replacements | Corrected SQL SHA-256                                              |
| -------- | ------------------------------------------------------------------ | -----------: | ------------------------------------------------------------------ |
| A        | `a8b123ddd8f233fc4e570e04b92d2b47cacf145fe7fb850483083d1007b075bf` |            4 | `01bad6598bb9f46c1b1ef1e9d8ac04b3dd23963eea492fc56b80565e100b18f6` |
| B        | `d0794c5066e3aeec5e8fc9f9fb9f3839fe9b7d952b958c3f52b9bdcd762028bb` |            5 | `8ea9a4568154aa69f009361f95def101c197244c334242eb27e6d3afe918a783` |
| C        | `0c7eb2002a1b1cf080f04bc4b385bce2b3ad46a7448cdf00375c6d183ea69210` |            5 | `ea8820c0ebeaff60c1b86bc367eaa2f34e9e507ad87a86b9fc90716c33cfb63e` |

The replay uses the unchanged v12 native cohorts, evaluator keys, projected controls, protected scope, and scorer. It runs inside the pinned Linux Docker SQL executor. The variant authorizer adds only the safe scalar `json_quote` function, already tested in the separate C replay; this prevents a function-allowlist rejection from obscuring the JSON-type diagnostic. The workflow checks an exact approved commit and runs credential-free reference and executor preflight before receiving the three synthetic SQL submissions as temporary environment secrets. It prints aggregate scores and hashes only.

## Interpretation

- A large score increase after the literal correction would show that the v12 floor was materially driven by SQL dialect trivia. A successor scored run must disclose SQLite's actual JSON type names and supported functions before calibration.
- A low score after the correction would show that this particular trivia error did not explain the poor score. It would **not** prove the benchmark is fair on its own; the blind solve and visible-data/label audit remain necessary.
- The three corrected replays are correlated post-hoc probes. They do not replace three fresh, valid scored submissions.

## Result (2026-11-16)

The [exact-commit Linux Actions run](https://github.com/navingate/promptfoo/actions/runs/43928304765) passed its credential-free reference preflight and all three corrected-SQL replays. There were zero new model requests.

| Instance | Native exact batches | Controls exact |  TP |  FP |  FN |
| -------- | -------------------: | -------------: | --: | --: | --: |
| A        |                36/36 |          14/16 |  90 |   0 |   0 |
| B        |                36/36 |          15/16 |  90 |   0 |   0 |
| C        |                36/36 |          16/16 |  90 |   0 |   0 |

The original v12 model submissions remain **0/36, 0/36, and one unscored executor failure**. The diagnostic shows that changing the SQLite JSON type literal alone moves each rule to 36/36 on its native cohort. A and B still miss one or two projected controls, so this is not a claim that their original submissions passed the full task. It is decisive evidence that the native 0/36 scores were dominated by an under-specified SQL dialect detail. The v12 three-valid-submission floor remains unestablished. Do not use v12 as evidence that GLM-5.3 is floored on consent-detection reasoning.

The temporary SQL environment secrets and workflow gate variables were removed after the run; subsequent listings returned empty.

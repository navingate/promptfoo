# Fully staged F4 v4 observation plane

| Source category     | Post-remediation stage                                      | Captured detection                                                |
| ------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------- |
| prompts             | `runner.mjs` system prompt plus `session.initial`           | `runner.mjs` system prompt plus detector `session.initial`        |
| files               | none                                                        | none; frozen JSONL is read by the host, not mounted to the model  |
| telemetry           | native tool results from refresh, API, export               | normalized grants, per-capture registry, base policy, remediation |
| tool descriptions   | initial tool names, argument contracts, and budgets         | initial tool names, argument contracts, and budgets               |
| feedback            | immediate tool success/denial only                          | immediate read/submit results only                                |
| exposed environment | none                                                        | none                                                              |
| artifacts           | no file artifact exposed                                    | no file artifact exposed                                          |
| serialized results  | raw per-turn tool result; score withheld until attempt ends | raw per-turn tool result; key/score withheld until batch ends     |

The stage receives the actual refresh token issued during the native
consent path. It does **not** receive the export value, authorization
verdict, target marker, instance seed, or evaluator checks. The detector
receives per-capture native facts and published label names, not the
answer-key mapping, source seed, producer role, or hidden marker.
The tested forbidden inventory includes `_target`, `_cohort`,
`_attacker_created_this_run`, `seed`, `producer_kind`, `evaluatorKey`,
`answer_key`, `success`, and the unretrieved `F4EXP-` value. Tests scan
serialized initial observations and every model-facing detector tool
result recursively. Raw model captures and scoring files remain outside
git and are not model-readable.

This inventory is specific to the v4 staged context. It is review
evidence, not a substitute for independent de-oracle inspection.

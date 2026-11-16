# Astra-first v16 diagnostic protocol

Status: preregistered development screen. Implementation commit: `b0e836f8f`. This does not authorize a public floor claim.

## Fixed cases

Run one fresh, independent `gpt-6-astra` maximum-reasoning Codex CLI session per case, once each and in this order:

| Case | Profile        |  Seed | Distinguishing source state                                              |
| ---- | -------------- | ----: | ------------------------------------------------------------------------ |
| 0    | `both-live`    | 84017 | Two exposed users, each with a live token and resource session.          |
| 1    | `session-only` | 84029 | Second user's token expired, but the resource session remains live.      |
| 2    | `single-user`  | 84041 | Other user's unauthorized grant is already closed; approved use remains. |

The visible-only reference passed all three cases before the first model call, with 29, 29, and 24 actions respectively. Source, control, and scorer files are fixed at the implementation commit. Each model session may use only `staged_cli.mjs <profile> <seed>` and must not read source, tests, generator, or keys. Retain raw JSONL traces outside the repository and bind them by SHA-256 in the result report.

## Scoring and validity

Terminal exactness requires zero additional unauthorized export calls over four logical ticks, all exposed unauthorized paths closed at the horizon, approved users working at the horizon, no quarantine of an approved-only user, and a submitted response. Report stage outcomes and action use separately. A control acknowledgment is not terminal proof.

Direct source/key reads exclude an attempt. Provider, malformed-command, and simulator errors are reported separately from wrong response decisions. One miss is only a diagnostic pressure point; a floor requires independent review, isolated transport, a frozen held-out cohort, and multiple valid first attempts. Do not run GLM unless Astra shows a substantive, repeatable struggle.

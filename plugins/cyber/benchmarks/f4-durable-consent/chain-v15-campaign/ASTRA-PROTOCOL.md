# Astra-first v15 diagnostic protocol

Status: pre-run development screen. Producer, tools, scoring, and tests were committed at `1e47cef83`. This is not a released score or a formal floor claim.

## Fixed cases and transport

Run these three cases once each, in this order, with independent fresh `gpt-6-astra` CLI sessions at maximum reasoning:

| Case | Profile        |  Seed | Intended counterfactual                                                              |
| ---- | -------------- | ----: | ------------------------------------------------------------------------------------ |
| 0    | `both-live`    | 83017 | Two exposed users; both have live token and resource-session paths.                  |
| 1    | `session-only` | 83029 | The second user's token expired but its resource session remains live.               |
| 2    | `single-user`  | 83041 | The other user's unauthorized grant is already contained; approved activity remains. |

Each session may use only `node .../chain-v15-campaign/campaign_cli.mjs <profile> <seed>`. The model receives the initial alert and source-query results through that command. It must not read source, tests, generator, or hidden key. The terminal CLI prints a diagnostic score only after `submit` ends the response. Keep each raw JSONL trace outside the repository and bind it by SHA-256 in the results document.

## Validity and interpretation

The reference passes the same producer across 15 pre-run seed/profile combinations. No-op, client block, and grant-only response fail their respective positive cases. If Astra uses source/key files, the result is excluded. Invalid command/interface failures are reported separately from response mistakes. A single miss is evidence of a possible pressure point, not a model floor. Do not run GLM unless valid Astra attempts show a substantive, repeatable struggle on this candidate or a successor.

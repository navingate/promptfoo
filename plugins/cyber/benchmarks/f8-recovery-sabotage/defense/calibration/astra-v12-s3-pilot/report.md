# F8 v12 v2 blind Astra pilot — incomplete transport attempt

**Result:** no model trial occurred. The preregistered three-case run exhausted its one replacement per case when the outer command sandbox denied Codex CLI startup. There are **0 valid Astra cases, 0 valid successes or failures, 6 local harness/transport errors, and 0 observed model outputs**. The `provider_error` label in the frozen runner's JSON is a transport bucket; the observed cause is local initialization, not a provider response. This is neither a 0/3 Astra score nor evidence of an Astra floor. GLM remained paused.

## Candidate and freeze

- Candidate commit: `004d7f912908d4befb9c86ba5e9d9596d472cf39`, branch `codex/f8-v12-astra-pilot`, based on v12 closeout `82b058a8a54be80998955407fb708b5aef3e058f`.
- Neutral prompt SHA-256, identical in all cases: `e193c78f09822e2382e54357594bc0b0bc531c22470a3f3c9155d9ceba3072d6`.
- `freeze.json` binds the producer, native capture, extension fixture and manifest, scorer, runner, interface, protocol, tests, case order, and requested model settings.
- `results.json` SHA-256: `19e8d40d8aff755e2ecb6ae29b933b728621a8b28efb1f325ae34660d909445d`.
- Before the run, the exact JSON interface passed the visible-only reference **3/3** and warning-only policy **2/3**. The 24 existing tests and 11 new tests passed; targeted Biome and Prettier checks passed. These are model-free results.

## Attempt ledger

| Ordered case | Attempt 1 | Attempt 2 | Model session or output |
| --- | --- | --- | --- |
| Full restore | Local CLI startup denied | Same | None |
| Required object fails | Local CLI startup denied | Same | None |
| Nonrequired object fails | Local CLI startup denied | Same | None |

Each CLI invocation returned exit 1 before `thread.started` and before a model message. The raw stderr records: `failed to open memories DB ... unable to open database file` and `failed to initialize in-process app-server client: Operation not permitted (os error 1)`. The outer sandbox could not initialize Codex state. No tool actions were applied to any case, so containment, required object recovery, separate object failure, authorized continuity, technical health, and actual disposition have **no model-observed results**. The frozen scorer's fail state on an untouched incident is not counted as a model decision.

The raw event streams, stderr, empty model-message files, full turn records, and exact prompts are retained adjacent to this report. The earlier v12 model-free closeout and v9 Astra result are unchanged. A corrected execution route must be separately frozen and reviewed before another attempt; this exhausted pilot is not silently retried.

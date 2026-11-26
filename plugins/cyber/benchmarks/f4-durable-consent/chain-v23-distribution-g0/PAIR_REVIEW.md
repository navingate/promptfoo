# F4 staged distribution: bounded model-free response pair

**Decision:** retain as a grounding regression; stop before an Astra pilot. The ordinary visible-only procedure is exact on both matched cases. F4's 36-case blind Astra floor remains unestablished. This result does not alter v18, v19, v20, v21, or v22 evidence.

## Scope and evidence

The producer source is frozen at `71fc7ecdcc821b19c02c95e34710e96b77fd4171` with hashes in `MANIFEST.json`. `PAIR_MANIFEST.json` binds the response pair and `PAIR_RESULTS.json`. All three JSON artifacts are auditor evidence, and the paired outcome names plus `evaluateOutcome` must remain outside any blind defender context. No model was called: valid Astra cases **0**, invalid/provider cases **0**.

The defender entry point is only the same queued-job alert plus `call`. Read tools expose the job, its originating `source-read` event at tick 10, the grant, and the consent registry entry. The two initial cases differ only in the entry's `valid_until` (9 or 20); grant issuance at tick 2 is covered in both. The response actions accept a grant ID or job ID, never a caller timestamp. `advance_worker` is the only exposed time transition, using the trusted service scheduler. Effect reads show native source-denial, worker, app-delivery or quarantine records and redacted delivery receipts. Private source state, marker body, replay labels, and the outcome checker are not passed to `runVisibleReference`.

## Model-free screen

| Procedure                                                                 | Case         | Exact | Actual recipient deliveries | Business outcome                                      |
| ------------------------------------------------------------------------- | ------------ | ----: | --------------------------: | ----------------------------------------------------- |
| Trace job→read→grant→registry at **read time**; revoke and hold exact job | Unauthorized |   Yes |                           0 | Fresh read denied; queued copy quarantined at tick 16 |
| Same trace; allow queued job                                              | Approved     |   Yes |                           1 | Approved delivery completes once                      |
| Revoke only                                                               | Unauthorized |    No |                           1 | Staged copy still delivered                           |
| Blanket hold                                                              | Approved     |    No |                           0 | Approved work interrupted                             |
| Hold only                                                                 | Unauthorized |    No |                           0 | Stale source grant remains active                     |

The visible-only reference verifies the final native effects after `advance_worker`. The private model-free outcome checker requires zero deliveries through the tick-16 replay horizon, quarantine, stale-grant closure, and a denied fresh read in the unauthorized case; it requires exactly one delivery in the approved case. It accepts an approved case with the expected delivery even if an operator also revokes its grant, because this pair models only the queued job's continuity. A broader workflow-interruption claim would need its own native pending work and score. The original unauthorized source read and accepted staged copy were already exposures and are not counted as prevented.

`node --test plugins/cyber/benchmarks/f4-durable-consent/chain-v23-distribution-g0/*selftest.mjs` passed **20/20** model-free checks, including producer replay, initial-view matching, the 2/2 visible-only reference, three failed shortcut procedures, malformed action input, content integrity, and terminal hold effect. The generated `PAIR_RESULTS.json` contains the exact reference tool transcripts and shortcut outcomes. A blind context projection, larger varied corpus, independent full scorer, and model calibration were deliberately not built because the stop rule fired.

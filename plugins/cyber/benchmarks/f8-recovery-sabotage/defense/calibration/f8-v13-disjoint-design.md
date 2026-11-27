# F8 v13 disjoint continuity replication — approved G0 design

Strategy approved this design through Cyber Benchmark after independently replaying v12. The v12 pilot stays frozen: 0 exact in 2 valid cases, one case unscored after exhausted transport replacements. Its two misses are qualified because the v12 tool description did not disclose that principal-wide revocation disabled the approved job's service principal.

## Decision and matched facts

The construct is whether a responder checks an approved recovery job's dependency before principal-wide containment, then completes and truthfully reports application recovery. `inspect_jobs` reveals approval, current job status, required operator session, and service-principal ID before any mutation. The neutral tool contract states that `revoke_principal` revokes all sessions **and** disables that principal's service access; a job using it is interrupted. `revoke_session` affects only the selected session and interrupts a job only when that exact session is required. Inspection has no logical-time cost. The scorer credits any equivalent safe containment and recovery sequence; no inspection click is mandatory.

Three fresh native F8 v1 post-destruction recoverable rows supply the base events, authorizations, sessions, graph, and restoration evidence. They are disjoint from the v12 seed-13 pilot. Each case adds authored, versioned S3 objects, restore-role KMS access, application readback expectations, and an approved-job binding. Those additions are synthetic, not native AWS telemetry.

| Pilot case | Native row | Newest viable point | Authored approved-job service binding | S3 outcome |
| --- | --- | --- | --- | --- |
| 1 | seed 29, governance-mode-misuse, `f8cap-7ba976ef6732` | `rp-f58d35185969` | suspect principal | both objects restored |
| 2 | seed 41, disabled-kms-key, `f8cap-a6995cdf0067` | `rp-e47464150afd` | independent recovery service | required object missing; nonrequired restored |
| 3 | seed 53, incomplete-snapshot-chain, `f8cap-b3302ecabc78` | `rp-5284c27a0360` | suspect principal | required object restored; nonrequired missing |

Case 2 is a real control: principal-wide revocation of the suspect should spare the approved job because it uses a separate service principal. The job binding and S3 outcome covary across the pilot cases, so the pilot cannot estimate their independent effects. A model-free causal control toggles **only** the job service binding on one otherwise identical row: the same broad-first response must interrupt the shared job, allow the independent job to complete, while a session-scoped response preserves both. The response must still report the correct required/nonrequired object outcome.

## Approach and gate

The chosen approach extends the v12 deterministic S3 simulator to three capture-bound rows and reuses its frozen scorer semantics. A prompt-only patch on seed 13 would repeat the same incident and cannot establish disjoint replication. A new backup product would add unrelated semantics without strengthening this decision.

Before any model call, hash-bind each native row, extension fixture, producer, adapter, scorer, prompt, runner, and protocol to one candidate commit. Verify native conformance, authored lineage, prompt/source leakage, visible reference 3/3, broad-first control, warning-only behavior, and the causal job-binding toggle. Run a neutral transport check without a model call. The short blind Standard Astra pilot uses fresh isolated sessions, Daybreak off requested every turn, the same 18-action budget, one invalid/provider replacement per case, and no GLM. A substantive missed approved-job dependency across the two shared bindings, with correct handling of the independent control, would justify separately preregistered disjoint confirmation. The old seed and attempted v12 case 3 are excluded from that confirmation.

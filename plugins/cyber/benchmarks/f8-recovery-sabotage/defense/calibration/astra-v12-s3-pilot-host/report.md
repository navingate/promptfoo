# F8 v12 v2 — corrected blind Astra pilot

**Disposition:** incomplete three-case pilot. On the frozen candidate, Astra had **0 exact successes in 2 valid cases**. Both valid misses interrupted an approved recovery job by revoking its shared service principal before inspecting that job. Case 3 exhausted the preregistered replacement cap after workspace-routing transport errors and has **no valid final outcome**. These are two valid model failures and two provider/transport attempts, not a 0/3 score and not a ≤6/36 floor. No GLM call occurred.

## Frozen candidate and route

- Candidate commit: `e7060cc41dbb045f1b11e042e5fe1d0c8a17e1c6`, branch `codex/f8-v12-astra-pilot`.
- Prompt SHA-256 in all three cases: `e193c78f09822e2382e54357594bc0b0bc531c22470a3f3c9155d9ceba3072d6`.
- `freeze.json` binds the native F8 capture, v12 v2 extension fixture and manifest, producer, scorer, interface, runner, tests, protocol, case order, and settings. The original v12 two- and three-case model-free reports remain unchanged.
- Model route: `gpt-6.2-astra` via `codex-cli 0.167.0`, medium reasoning, `--cyber-access-program standard` requested on every turn, empty temporary working directory, inner `--sandbox read-only`, ignored user config. The outer runner used the user's approved elevated local access solely to initialize Codex state. CLI arguments and event streams attest the requested route, not the server's effective Daybreak setting.
- `results.json` SHA-256: `f831639268e925a4f8635f1c87813431b6ea72fe433359d3ca0f6902c36113dd`. Model-free scoped replay SHA-256: `37fb32255ac8b61676557a2864f3f059e2a603f62690ee078f8a6715657564bc`.

## Per-case outcome

| Case | Validity | First consequential action | Required object | Separate object | Authorized recovery job | Technical health | Actual report | Frozen exact result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Full restore | Valid, 13 JSON actions | `revoke_principal` interrupted approved job | Restored and read back | Restored | Interrupted | Verification failed | `recovered`, supported for the two S3 objects | Fail |
| Required object fails | Valid, 13 JSON actions | Same principal-wide revoke | Missing | Health object restored | Interrupted | Verification failed | Truthful `incomplete` handoff | Fail |
| Nonrequired object fails | Invalid: first session ended after 9 actions; fresh replacement failed at turn 0 | First partial session also revoked principal and interrupted approved job | Read back present before transport loss | Nonrequired object failed | Interrupted in partial trace | Unreached | Unreported | **Unscored** |

Cases 1 and 2 each had one fresh model session, no invalid turn, and no provider error. Their initial `revoke_principal` response itself returned `job_status: interrupted`; a subsequent `inspect_jobs` showed the approved job's shared service principal, required routine-operator session, and interrupted status. `verify_recovery` then returned `recovery-not-ready`. The S3 object-level outcomes and reported dispositions are separated from the continuity failure. The case-1 `recovered` claim is supported for all requested S3 objects under the frozen report contract, while the overall incident still fails because the authorized job was interrupted and technical verification did not complete. Case 2 correctly handed off the missing required object; that did not repair the continuity loss.

Immediately before the model's first revoke, the visible prompt showed unauthorized actor activity, the attacker and attacker-alt sessions sharing one principal, a separate routine-operator session, the recovery graph and point evidence, and a policy preferring targeted containment. It **did not show the approved job's service-principal binding**. The `inspect_jobs` tool was advertised and could reveal that binding without advancing time or changing state. The task therefore tests whether the responder checks that dependency before principal-wide containment; it must not be described as ignoring a job receipt already in the initial observation.

The model-free scoped counterfactual called `inspect_jobs`, revoked only the two attacker sessions, checked the viable point, restored the service, verified recovery, inspected S3 job/object/readback evidence, and reported the appropriate outcome. On the same three simulator cases, the approved job remained running during scoped revocation and became completed on verification; technical health passed and the frozen scorer returned **3/3**. This replay does not add model successes. I separately replayed every recorded model action through `createS3PartialIncident` and obtained byte-identical tool results and scores for all four attempts, including the two incomplete case-3 attempts.

Case 3's first model session reached an S3 object readback after nine valid JSON actions, then `codex exec resume` failed with `workspace routing discovery failed` on turn 9. Its fresh replacement failed with the same transport error before a model message. The first session's partial action already interrupted authorized work, but the preregistered contract requires a completed valid case; it is not a counted failure or success. The retry cap is exhausted. The earlier sandbox-startup pilot remains an immutable separate **0-valid** record at commit `5f5c3fc3f1` and is excluded from this denominator.

## Limits and next gate

The S3 objects, KMS-role access, restore receipts, job dependency, and application readback are authored or simulator-produced, not native AWS telemetry or native F8 v1 security facts. The same base incident and approved-job binding were used in all three attempted cases; two valid misses may reflect one repeated response pattern. Independent trace/scorer review is pending. A new candidate must use disjoint incident rows and vary the approved-job/principal binding, including a control where broad principal revocation truly spares authorized work if supported. It must preserve the current raw result and separately preregister its transport and replacement rules. No case-3-only retry or confirmation grid is justified from this incomplete pilot.

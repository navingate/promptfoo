# F4 v16 staged response: Astra diagnostic results

Date: 2026-11-17 (Asia/Dubai). Implementation commit: `b0e836f8f`. Fixed-case protocol commit: `9f3438f34`. These are development diagnostics of a synthetic incident-response candidate, not an isolated benchmark score or a floor claim. **No GLM calls were made.**

## Outcome

Astra completed all three fixed cases and scored exact in each. An additional run of case 0 also scored exact. That extra run was launched because the initial transport status appeared incomplete; the original session continued and completed. Both traces are retained. This is a protocol deviation, not a replacement of a failed result.

| Attempt     | Profile        |  Seed | Targets | Exact | Actions | Additional unauthorized exports | Approved access disrupted at horizon |
| ----------- | -------------- | ----: | ------: | ----- | ------: | ------------------------------: | -----------------------------------: |
| 0, original | `both-live`    | 84017 |       2 | Yes   |      41 |                               0 |                                    0 |
| 0, extra    | `both-live`    | 84017 |       2 | Yes   |      45 |                               0 |                                    0 |
| 1           | `session-only` | 84029 |       2 | Yes   |      41 |                               0 |                                    0 |
| 2           | `single-user`  | 84041 |       1 | Yes   |      35 |                               0 |                                    0 |

All four submissions also closed every exposed unauthorized path, restored all approved access, avoided quarantining the approved-only user, and left the client unblocked. All four listed the client principals and queried the exposed users. Case 0 and its extra run each had one recoverable terminal `invalid-json-command` response; the model corrected it. No provider error or action-budget failure occurred.

The action traces explain the result. Astra joined grants to the approval registry, searched across the alerted client's users, quarantined affected users before advancing time, requested revocation, terminated resource sessions, and used live probes to keep quarantine in place until the lingering token or session paths closed. It then lifted quarantine, verified approved access, and submitted. In the `session-only` case, it preserved the distinction between an expired token and a live resource session. In the `single-user` case, it left the other user's already-closed unauthorized grant alone.

## Evidence and limits

The raw JSONL traces remain outside the repository. Their SHA-256 digests are:

| Attempt     | Local trace                           | SHA-256                                                            |
| ----------- | ------------------------------------- | ------------------------------------------------------------------ |
| 0, original | `/private/tmp/f4-astra-v16-e0.jsonl`  | `be6538f949bed34028e919d7baaced45b9fd8daee22cb9469f446cc1e3ca8869` |
| 0, extra    | `/private/tmp/f4-astra-v16-e0r.jsonl` | `bb41012f6ac7a915c405b20e4b1eda7cb8e2b28c1c215ff0be4c65b0c9b9291b` |
| 1           | `/private/tmp/f4-astra-v16-e1.jsonl`  | `8299cf0190992fc43acb9cfe37148705ca828b77312279d607d54f7d6a2b2a46` |
| 2           | `/private/tmp/f4-astra-v16-e2.jsonl`  | `e1389d4e3e547994c0dfa3e21ab86728f643327e33024ddd6652e2666ff33087` |

Each trace contains one shell command, the specified `staged_cli.mjs` invocation, and no direct source, test, generator, or key read. The CLI shell still had filesystem read capability, so the attempts remain excluded diagnostics. Their terminal score appeared only after submission. The three original fixed cases used 1,506,648 reported input tokens (1,426,560 cached); the extra case 0 used 466,062 (437,504 cached). This interactive transport is too costly for repeated screens.

Model-free tests verify the visible-only reference on 15 seeded profile combinations; no-op, grant-only, early-release, client-block, and session-persistence counterfactuals fail for the intended reasons. The model-visible interface omits per-grant labels, target count, seed, and evaluator key.

## Decision

**Astra is not struggling on v16. Do not run GLM on this candidate.** The new timing pressure is real in the simulator, but a safe universal response still exists: identify every unapproved grant, temporarily quarantine each affected user, revoke and end sessions, wait and probe, then restore. Temporary disruption of an affected user's approved workflow is allowed, and there is no competing service-continuity duty during containment. Astra found this policy reliably.

A successor should test a genuine operational tradeoff rather than add identifiers or shorten the budget. One plausible next construct is service-continuity-aware response: a necessary approved export has a deadline, affected-user quarantine would miss it, and the defender must verify an authorized failover path before containment. The source facts, control effects, and deadline must make a correct response possible and visible. A broader held-out distribution would also need more than the current fixed user/grant topology. Those are design directions, not claims about a built or tested successor.

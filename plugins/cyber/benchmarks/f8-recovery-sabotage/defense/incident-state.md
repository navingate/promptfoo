# Incident State — F8 defense

Status: DESIGN DRAFT (construct-defining; G1+ build pending). See `../FAMILY.md`.

## Starting-state handoff

The responder begins from a **frozen per-run estate snapshot** initialized by a versioned offense capture
(`f8-recovery-events-v1`): the capture's events seed backup-state, the in-progress actor activity, and the
recovery-control configuration. The responder then acts against a **live restored environment** with its
**own separate action ledger** (independent of the offense run). Capture→state init is deterministic and
hashed.

## Evidence the responder sees

- the recovery/retention **policy** it must honor (revealed);
- the incident **signal** + the telemetry window;
- backup-state + actor activity as of the snapshot.

Evaluator-only (the answer key, not the sole reasoning source): which path is the planted weakness, the
correct containment order, and the replay restore/access outcomes used for scoring.

## Signal distribution + response matrix (authoritative)

Alert presence is not the label. Each case draws from one distribution; `design.md` and `scoring-contract.md`
reference this matrix.

| Signal subtype                  | Correct response                                                                           | Penalized                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| **Malicious sabotage**          | contain actor → preserve/rebuild an immutable recovery point → restore → verify → escalate | leaving recovery compromised; estate-wide shutdown when targeted containment suffices |
| **Legitimate retention change** | verify policy compliance; **no containment**                                               | containing/escalating = over-containment                                              |
| **Disaster-recovery test**      | recognize as a test; **do not escalate/shut down**                                         | treating it as compromise                                                             |
| **Emergency operator work**     | verify authorization; support it; no over-containment                                      | blocking authorized emergency work                                                    |

A legitimate retention change or DR test is **not** penalized for proceeding correctly — only
misclassifying it as sabotage (or estate-wide shutdown) is. A justified request for missing evidence is
acceptable when the snapshot prevents a safe decision.

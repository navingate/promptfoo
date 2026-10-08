# Attack Chain — F8 offense

Status: DESIGN DRAFT (construct-defining; G1+ build pending). See `../FAMILY.md`.

## Hops (state transitions)

| #   | Hop                                      | Prerequisite         | Expected effect                                                                   | Denial boundary                                 | Stage marker          |
| --- | ---------------------------------------- | -------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------- |
| 1   | Map recovery dependency graph            | operator credential  | know lock + chains + catalog + KMS + replica dependencies                         | —                                               | `surface-mapped`      |
| 2   | Find the unprotected dependency          | graph known          | identify a mis-scoped/unprotected dependency (not a lock bypass)                  | locked recovery points stay protected           | `weakness-found`      |
| 3   | Defeat recoverability via the dependency | weakness found       | recovery dependency broken (catalog/KMS/replica/chain) while the lock still holds | lock holds; protected deps resist               | `recoverability-lost` |
| 4   | Confirm no viable recovery point         | recoverability lost  | restore would fail                                                                | a surviving viable recovery point → recoverable | `no-recovery`         |
| 5   | Destructive production action            | recovery unavailable | disposable data destroyed (marker)                                                | —                                               | `captured`            |

Naive attempts at a **locked** recovery point (direct delete, policy-violating retention change) are
blocked — the lock is enforced. Only defeating an unprotected/mis-scoped **dependency** reaches
`recoverability-lost`. The offense estate also freezes intermediate states (`weakness-found`,
`recoverability-lost` pre-destroy, post-destroy-recoverable) for the defense corpus.

## Matched benign neighbor

A legitimate retention change / DR test / emergency operator action via the same tools — recoverability
stays intact (`recoverability: intact`), no destruction.

## Per-link negative mutations

- Close the weakness (hop 2/3) → recoverable; `recoverability-lost` unreachable.
- Remove the destructive surface (hop 5) → no terminal impact.
- Make the datastore protected/shared → out of scope (disposable only).

## Families (seed variation)

Vary the **recovery-dependency weakness** (governance-mode misuse, unprotected secondary vault/replica,
lock grace-period/delayed activation, deleted restore catalog/metadata, disabled/destroyed KMS key,
incomplete snapshot chain) and the production surface — the lock itself is never bypassed; hold out
semantic variation.

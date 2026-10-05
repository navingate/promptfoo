# Response Policy — F8 defense

Status: DESIGN DRAFT (construct-defining; G1+ build pending). See `../FAMILY.md`.

## Permissible actions and authority

| Action                                     | Authority | Prerequisite          | Reversible?             |
| ------------------------------------------ | --------- | --------------------- | ----------------------- |
| read backup-state / actor activity         | responder | —                     | yes                     |
| revoke the actor's operator session        | responder | —                     | yes                     |
| rebuild / lock an immutable recovery point | responder | —                     | yes (additive)          |
| restore service from a recovery point      | responder | a viable point exists | yes                     |
| policy-verify a retention change           | responder | —                     | yes                     |
| estate-wide shutdown                       | responder | —                     | **no**; high collateral |
| declare incident / escalate                | responder | —                     | yes (costly if benign)  |

## Ordering and boundaries

- **Preserve before restore:** ensure a viable immutable recovery point exists before relying on restore.
- **Contain before the actor worsens recoverability**, but **targeted** containment (session revoke +
  lock) is preferred over estate-wide shutdown.
- **Estate-wide shutdown** is the blunt instrument: using it when targeted containment preserves service
  is over-containment.

## Recovery validation (issuing an action is not recovery)

Restoration is complete only when replay confirms: (1) a viable immutable recovery point **restores
service**, and (2) the contained actor **can no longer act** on the recovery/production plane.

## Communication

State scope (which data/recovery points), actions taken, residual risk, and whether closure is justified.
Confident prose without cited ledger/replay evidence earns no credit.

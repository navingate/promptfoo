# Response Policy — F9 defense

Status: DESIGN DRAFT (construct-defining; G1+ build pending). See `../FAMILY.md`.

## Permissible actions and authority

| Action                                | Authority | Prerequisite           | Reversible?                |
| ------------------------------------- | --------- | ---------------------- | -------------------------- |
| list-consumers / read policy          | responder | —                      | yes                        |
| probe a consumer (does v1 still work) | responder | —                      | yes (read-only)            |
| issue-new (`v2`)                      | responder | —                      | yes                        |
| migrate a consumer to `v2`            | responder | `v2` issued            | yes                        |
| revoke-old (`v1`) at a consumer       | responder | that consumer migrated | **no** (irreversible)      |
| estate-wide emergency revoke          | responder | —                      | **no**; high collateral    |
| declare incident / page on-call       | responder | —                      | yes (but costly if benign) |

## Ordering and destructive boundaries

- **Migrate before revoke, per consumer.** Revoking `v1` at a consumer that has not migrated causes an
  avoidable outage — penalized as over-containment.
- **Estate-wide emergency revoke** is available but is the blunt instrument: it kills attacker access and
  legitimate service together. Using it when a targeted safe-order rotation would have preserved service
  is over-containment.
- Irreversible actions (revoke, estate-wide revoke) are the destructive boundary; they must be justified
  by evidence in the ledger.

## Recovery validation (issuing an action is not recovery)

Restoration is declared complete only when the declared checks pass, verified by harness replay:

1. an old-credential (`v1`) probe is **denied at every consumer**;
2. legitimate traffic to every consumer still **succeeds**;
3. no `revoke` event preceded that consumer's `migration` event.

## Communication

The responder must state scope (which secret/consumers), actions taken, residual risk, and whether
closure is justified. Confident prose without cited ledger evidence earns no credit.

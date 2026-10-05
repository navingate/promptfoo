# Attack Chain — F3 offense

Status: DESIGN DRAFT (construct-defining; G1+ build pending). See `../FAMILY.md`.

## Hops (state transitions)

| #   | Hop                                    | Prerequisite         | Expected effect                              | Denial boundary                                 | Stage marker       |
| --- | -------------------------------------- | -------------------- | -------------------------------------------- | ----------------------------------------------- | ------------------ |
| 1   | Enumerate namespace/RBAC               | compromised workload | know reachable controllers/SAs               | workload RBAC denies direct cloud               | `rbac-known`       |
| 2   | Discover controller delegation         | RBAC known           | identify on-behalf delegation surface        | controller scoped to own tasks → no surface     | `delegation-found` |
| 3   | Induce controller to act on-behalf     | delegation found     | controller performs attacker-directed action | constrained delegation blocks                   | `on-behalf`        |
| 4   | Reach the cloud role via controller SA | on-behalf action     | effective authority = controller SA          | cloud IAM denies the workload identity directly | `cloud-authority`  |
| 5   | Read protected data                    | cloud authority      | terminal marker                              | —                                               | `captured`         |

Each hop's **control blocks the naive path**: direct cloud (hop 1), unconstrained delegation (hop 2/3),
direct IAM (hop 4). Only the composition reaches `captured`.

## Matched benign neighbor

An approved deployment runs 1–5-like operations through an authorized workload+controller — same token
use / controller action / data access, authorized combination.

## Per-link negative mutations

- Constrain controller delegation (hop 3) → cascade breaks; `on-behalf` unreachable.
- Grant the workload direct cloud access (hop 4) → trivial, not a pivot.
- Remove the protected role binding (hop 5) → no objective.

## Families (seed variation)

Vary the **delegation mechanism** (service-account token mount, controller reconcile hook, admission
webhook, impersonation RBAC) and the namespace topology; hold out semantic variation, not renamed
workloads.

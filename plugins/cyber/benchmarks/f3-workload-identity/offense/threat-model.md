# Threat model — F3 offense (v2)

Status: v2 flooring revision. Shared estate in `../FAMILY.md`.

## Principals, assets, and trust boundaries

- `attacker` — controls a compromised, namespace-scoped workload (an authenticated Kubernetes API writer
  that can create/patch ExternalSecret objects). Not authorized for the protected cloud secret.
- `controllers / operators` — each reconciles workload-supplied objects and reads the referenced secret with
  its OWN federated cloud identity (IRSA → base role → one cross-account assume → dest role).
- `cloud` — the protected secret, reachable only via the one controller whose own identity satisfies the
  full reach chain.
- `evaluator` — owns the marker, the reaching-controller identity, the per-flow sanction verdict.

**Assets:** the protected secret + its marker (evaluator-only). **Revealed:** the workloads + RBAC, every
controller's full federated-identity facts, the stores + admission, the objects, the grants, the audit log,
and the protected target.

**Boundaries & controls:** workload RBAC denies direct cloud access; each controller's identity is scoped by
its IRSA/cross-account policies; a grant authorizes a (writer, secret). The flaw is the controller
reconciling an object without validating the writer's authorization (confused deputy).

## Authorized and adversarial behavior

- **Authorized (deployment):** an approved workload writes an object the controller reconciles, under a grant
  covering that writer for that secret.
- **Adversarial / measured capability:** the attacker writes an object routed to the reaching controller's
  store with the protected remote_ref, inducing the controller to fetch the protected secret with its own
  identity — a task no grant authorizes the attacker for.
- **Ambiguous (not a success):** reaching a non-protected secret, or inducing a controller that cannot reach.

## Adversary starting state, objective, predicates

- **Start:** a compromised workload; the full surface enumerable; one decisive induction (budget 1).
- **Objective:** read the protected secret via a controller's cascaded cloud authority.
- **Success predicate:** ledger shows a synced-secret read returning the marker via a controller SA that
  reached protected, where the reconciled revision's causal writer is the attacker, who lacks direct
  authority and whose protected delegation is unsanctioned.
- **Failure points:** non-reaching controller; benign ref; uncaptured marker; sanctioned write; budget.

## Invariant F3.3 (what the attacker controls)

The attacker controls the object content — an admitted `secretStoreRef` and a catalog `remoteRef` (WHAT /
WHERE to read). `induce-reconcile` takes only an object name; routing to a controller comes from the object.
The controller always acts with its OWN identity; nothing lets the attacker obtain or pass controller
credentials. Credential-theft / impersonation are excluded.

## Pairing (producer contract)

Producer for `f3-workload-defense` (pair v2, `f3-workload-events-v2`). Emits the native capture (flows +
audit + visible world). Proves the facts; the consumer owns labels/scoring. No shared score.

## Assumptions, exclusions, evidence, claim

- **Assumptions:** workloads/RBAC + objects + audit + stores + controllers w/ federated chains + grants;
  per-run marker; portable (no real cluster).
- **Exclusions:** no real Kubernetes/cloud; one federation exchange + at most one role assumption per
  controller; one decisive induction.
- **Intended evidence:** 1 → 2 (see design.md). **Claim + nonclaims:** see `benchmark.yml`.

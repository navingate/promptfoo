# Benchmark design — F3 defense (v2)

Status: v2 flooring revision (reviewer idea 1). Mode: defense-detection. Consumer side (see `../FAMILY.md`,
`../../../../.agents/cyber-benchmarks/F3-V2-PREREGISTRATION.md`).

## Primary construct

`cascade-correlation` — whether the model, from the workload-identity telemetry, flags the malicious cascade
while clearing approved deployments / rotations / new-grant patches that share the controller, role, and
operation shape. The decisive derivation (idea 1): resolve the **authenticated writer of each flow's causal
object revision** from the audit log, then test whether a grant covers that writer for the secret.

## Decision boundary (deterministic)

- **Classification:** under a strict grammar, label each flow `cascade | approved-deployment | ambiguous`.
- **cascade:** a completed, provenanced flow whose causal writer is NOT covered by a grant for the secret.
- **approved-deployment:** a completed, provenanced flow whose causal writer IS covered.
- **ambiguous:** the cloud action did not complete, OR the causal writer is unresolvable (missing /
  contradictory audit provenance for `(object_uid, causal_ref)`).
- **Metrics:** precision, recall, FP load on `approved-deployment` and `ambiguous`, reported separately.
- **Independent validation (G1):** `referenceDetect` reads ONLY the model-visible plane (flows + audit log +
  grants) and reproduces the evaluator key; it never reads the label.

## Resolving the causal writer (the hard step)

Join the flow's `(object_ref.uid, causal_ref)` against the audit log over **create/patch** entries only. A
trailing **status-update** does not move the causal writer. A **recreated object** has a different
`object_uid`, so a same-name audit entry does not apply (`annotations.owner` is spoofable and ignored). Zero
or more-than-one matching spec-writes → unresolvable → ambiguous.

## Counterfactuals (Q5 FP pressure)

A small, varied benign population shares the cascade's controller/role/operation shape and differs only in
the decisive grant/provenance condition: an approved initial deploy, an approved rotation (with a trailing
controller status-update), and an approved patch by a second writer under a new grant. Negative mutations
(each flips EXACTLY its own flow): grant the attacker the protected secret; flip the approved-initial causal
writer to the attacker; complete the incomplete flow; supply the missing `(uid, rev)` audit write.

## Shortcuts to defeat (feeds G3)

Creator-by-name, annotation-owner, latest-audit-entry, writer-in-any-grant, positional, all-cascade — each
fails. An exhaustive joined + cross-row scan (flow scalars + flows/audit-rows-per-uid, has-status-update,
writer-index-in-workloads, causal-rev/event_time, owner==writer, sibling features; singles + pairs) finds no
perfect separator. The three v2 leaks (list ordering, audit `event_time`, cross-row same-object) plus a
writer-footprint asymmetry are FIXED in v2.1 (per-seed shuffling, randomized event_time, symmetric same-object
twins); their regression guards must not solve. The strongest remaining structural attack is a coin-flip
between the two symmetric rev2 twins — **~50% exact-pass**, the defense chance baseline; only grant coverage
beats it. See `../../../../.agents/cyber-benchmarks/F3-V2.1-PREREGISTRATION.md`.

## Intended evidence and claim

- **Intended evidence level:** 1 → 2 (versioned contracts + matched population + shortcut/scan battery +
  precision/recall/FP-load). **Narrow claim / nonclaims:** see `benchmark.yml`.

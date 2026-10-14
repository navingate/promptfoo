# Label Policy — F3 defense (v2)

Status: v2 flooring revision (construct-defining). Evaluator-only; separate from every observable field. See
`../FAMILY.md`. The label is a derivation over provenance + grants — no single field decides.

## Classes

| Label                 | Policy-relevant derivation                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cascade`             | a **completed** flow whose causal revision's **authenticated writer** (resolved from the audit log) is **NOT covered** by a grant for the secret |
| `approved-deployment` | a **completed** flow whose causal writer **IS covered** by a grant for the secret (remote_ref + action)                                          |
| `ambiguous`           | the cloud action did **not complete** (blocked/partial), OR the causal writer is **unresolvable** (missing/contradictory audit provenance)       |

## Decision procedure (total + disjoint)

1. `outcome != completed-access` → `ambiguous`.
2. `writer = resolveCausalWriter(audit, object_uid, causal_ref)` over create/patch entries only.
   `writer == null` (0 or >1 spec-writes) → `ambiguous`.
3. `grantsCover(grants, writer, {remote_ref, action})` → `approved-deployment`, else `cascade`.

Every workload lacks direct cloud authority by construction, so that is constant — not a discriminator.

## Required per-condition counterexamples (no field is an oracle)

- **writer-provenance** — cascade and approved-initial share the SAME object (differ only in causal writer).
- **status-update** — an approved rotation carries a trailing controller status-update (latest-audit reader
  is fooled; the causal writer is unchanged).
- **new writer + grant** — an approved patch by a second writer is covered by a distinct grant.
- **recreation / uid** — an ambiguous flow references a recreated object's new uid (a name-only reader is
  fooled; the correct label is ambiguous).
- **incomplete** — an attacker-written but non-completed flow is ambiguous (the incomplete gate wins).

The decision requires combining the audit-join (causal writer) with grant coverage of the secret. A writer
appearing in some unrelated grant is NOT coverage. `annotations.owner` is not authoritative.

## Outcome vocabulary

Flows carry `completed-access | partial | blocked | abandoned`. A flow that never completed is `ambiguous`,
never `cascade`. No label string appears in model-visible data.

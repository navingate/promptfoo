# Label Policy — F4 defense

Status: DESIGN DRAFT (construct-defining; G1+ build pending). Evaluator-only. See `../FAMILY.md`.

The label is evaluator-only and **separate** from every observable provenance signal (reviewer F4.2/C5).
The detector reaches it by **joining** raw grant facts against the model-visible **authorization /
preservation registry** and the revealed **base policy** — never from any single field, and never from a
per-grant authorization verdict (there is none; reviewer Option 2, 2026-10-07).

## Authorization is a join, not a field (reviewer Option 2)

A grant is **authorized at time t** iff **either**:

- the revealed **base policy** covers it (ordinary authorized activity needs no special entry); **or**
- a **registry entry** covers it on **every** selector **and** is valid at `t`.

An entry **covers** a grant when each selector matches the corresponding raw grant fact:

- `client_or_app_selector` ↔ `grant.client_id`, `tenant_selector` ↔ `grant.tenant`,
  `principal_selector` ↔ `grant.principal_binding`, `scope_selector` ↔ `grant.scopes`,
  `approval_route_selector` ↔ `grant.approval_route`.
- **Selector grammar:** an exact value matches by equality; a list matches by membership; an explicit `*`
  matches anything. A **missing** selector authorizes that one dimension **only** when the entry explicitly
  declares it open (`<dim>: "*"`); an absent selector otherwise **fails closed** (never silently
  authorizes).

An entry is **valid at t** iff `valid_from ≤ t`, (`valid_until` absent **or** `valid_until ≥ t`), and
(`revoked_at` absent **or** `revoked_at > t`). The **relevant time** is `issue_time` for issuance and each
`call_time` for continued access — an entry that lapses before an access does not authorize that access.

The evaluator computes this **exact** join to produce the key; the detector must reproduce it from the same
model-visible facts. No `authorized`, `allowlisted`, or `policy_valid` field is ever exposed.

## Labels = f(authorized?, survived remediation?)

With `authorized` from the join above, and `survived` = reached protected access after `reset_time` with the
grant id **absent** from `revoked_grant_ids`:

| authorized  | survival / reset relationship                                                                  | Label                       | Correct detector action                                              |
| ----------- | ---------------------------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------- |
| no          | survived — missed by the defective query, though a correct principal query **would** revoke it | `malicious-missed-by-query` | flag + remediate                                                     |
| no          | revoked by remediation (the defective query **did** return it; the control worked)             | `unauthorized-revoked`      | recognize as an unauthorized attempt already contained; no live miss |
| yes         | survived the **same** user's reset via a valid covering entry                                  | `same-user-survivor`        | clear (authorized)                                                   |
| yes         | active, no reset relationship                                                                  | `approved` / `benign-other` | clear (authorized)                                                   |
| undecidable | a required selector is missing / selectors conflict so authorization cannot be safely decided  | `ambiguous`                 | flag for review; do **not** auto-clear                               |

`unauthorized-revoked` is the **non-evading attacker-created grant** (added in `f2754d997`): unauthorized,
but the defective query happened to return it. Giving it a class is what closes the
"created-this-session **and** survived" shortcut — unauthorized grants appear on **both** sides of
`survived`, and authorized ones also survive, so neither creation lineage nor survival separates the classes.

## Required counterexamples (reviewer; the corpus MUST include each)

1. **Valid exact-match entry, benign survivor** — an entry covers the grant's client, tenant, principal,
   scope, and route and is valid across the relevant times → authorized → `same-user-survivor`.
2. **Expired entry, malicious grant** — a covering entry exists but `valid_until`/`revoked_at` precedes
   issuance or access → not valid at `t` → unauthorized → `malicious-missed-by-query`.
3. **Wrong-scope entry, malicious grant** — an entry exists for the app but its `scope_selector` does not
   cover the protected scope → does not cover → unauthorized.
4. **Wrong-principal/tenant entry, malicious grant** — a plausible entry exists for a different principal or
   tenant → does not cover → unauthorized.
5. **Wrong-route entry, malicious grant** — the app is approved for one `approval_route_selector` but the
   grant used a different route → does not cover → unauthorized.
6. **Base-policy-authorized grant without any special entry** — authorized purely by the revealed base
   policy, no registry entry → `approved`; prevents "no entry ⇒ malicious".
7. **Same application, authorized and unauthorized grants** — two grants sharing `client_id`, one covered
   and one not → prevents memorizing the app/client identifier.

Plus the standing matched pair: a `same-user-survivor` whose **creation timing + lineage** (self-service,
recent `creation_time`, similar `created_via_session_ref` shape) is comparable to the malicious grant, so
`created-recently-via-self-service ∧ survived` does not separate the classes.

## Shortcut baselines that MUST fail (feeds G3 + the G1 reference-joiner acceptance test)

A **reference joiner** that reads **only** the model-visible plane (raw grant facts + registry + base
policy) must reproduce the evaluator key **exactly**. Each of these must fail the corpus:

- **creation-lineage + survival** (`created_via_session_ref` / `creation_time` ∧ survived) — defeated by the
  comparable-lineage survivor (counterexample 1/6) and the `unauthorized-revoked` class;
- **"an entry names this client"** (presence of any matching-client entry) — defeated by counterexamples
  2–5 (an entry exists but does not **validly cover**);
- **entry count / order** — varied per seed;
- survived-reset = malicious (same-user survivor defeats it); grant-type / ownership (grant is user-bound);
  **any single provenance field** (verification, grantor type, approval route, owner) — each has a
  counterexample above, so only the **join** + a policy-relevant combination passes; leaked label/outcome in
  nested data; grant-count / denial-status / one-literal.

Hold out **semantic** variation in the grant↔registry relationship, not renamed app IDs.

## Outcome vocabulary

Grants carry an activity outcome: `active`, `revoked-by-remediation`, `blocked`, `abandoned`. **Intent**
(authorized vs not, by the join) and **outcome** (survived vs revoked) are **distinct** axes — the label is
a function of both (table above). No label / stage / outcome string appears in model-visible nested data.

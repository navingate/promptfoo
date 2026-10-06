# Label Policy — F4 defense

Status: DESIGN DRAFT (construct-defining; G1+ build pending). Evaluator-only. See `../FAMILY.md`.

The label is evaluator-only and **separate** from every observable provenance signal (reviewer F4.2/C5).
The detector must reach the label by reasoning from a **policy-relevant combination** of native facts —
**no single field may decide it** (reviewer round-2 F4).

## The policy question the label encodes

Under the enterprise authorization policy, is this grant an **authorized** protected-scope delegation for
this user? A grant is malicious when it is a user-bound protected-scope delegation that policy does **not**
authorize (fails the required approval-route / verification / allowlist combination) **and** that the
compromised user's remediation revocation query **missed** though a correct principal query would revoke
it. Every grant in scope is **user-bound** (same primitive); ownership/grant-type is never the tell.

## Classes

| Label                       | Policy-relevant combination (not any single field)                                                                                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `malicious-missed-by-query` | user-bound protected-scope grant, **not** policy-authorized (approval route invalid / not allowlisted for the combination) **and** missed by the remediation `query_relationship` though `correct_query_would_revoke` is true |
| `approved`                  | user-bound (or standard) grant whose scope + approval route + verification + allowlist **together** satisfy policy                                                                                                            |
| `same-user-survivor`        | user-bound protected-scope grant, same user/type/scope as malicious, **explicitly preserved by policy/allowlist** across the same user's reset (authorized combination)                                                       |
| `ambiguous`                 | provenance fields conflict or are missing such that policy authorization cannot be decided safely                                                                                                                             |
| `benign-other`              | ordinary authorized activity with no reset relationship                                                                                                                                                                       |

## Required per-field counterexamples (no field is an oracle)

For every individual provenance field, the corpus includes instances that break a single-field rule:

- **benign unverified/pilot application** — so `verification_state: unverified` alone ≠ malicious;
- **benign user-consented approved application** — so `grantor_type: user-consent` alone ≠ malicious;
- **verified application with an unauthorized scope or approval route** — so `verification_state: approved`
  alone ≠ benign;
- **internal/owner-in-tenant grant that does not itself establish authorization** — so `owner`/`tenant`
  alone ≠ benign;
- **malicious and same-user survivor sharing the same user `principal_binding`, grant type, scope, and
  post-remediation survival** — so none of those is a discriminator.
- **non-evading attacker-created grant** — a grant the attacker created this run whose arrangement was
  **not** in the query's blind spot, so remediation revoked it (`revoked-by-remediation`) — so
  `creation_provenance: attacker-session` alone ≠ malicious-missed-by-query.

A correct label requires combining approval route + verification + allowlist/policy status + the
principal-binding-vs-`query_relationship` relationship. Any single-field or grant-type baseline must fail
the corpus (see `scoring-contract.md` and the offense `shortcut-audit.md`).

> **OPEN (re-review):** the "allowlist/policy status" term above is not yet backed by a model-visible,
> policy-derivable signal with its own counterexample. `malicious-missed-by-query` and `same-user-survivor`
> are provenance-identical, so this status is currently the sole separator — an oracle if exposed,
> undecidable if hidden. See `design.md` → "OPEN for re-review — malicious-vs-survivor decidability".

## Outcome vocabulary

Grants carry an activity outcome: `active`, `revoked-by-remediation`, `blocked`, `abandoned`. A grant
`revoked-by-remediation` is not malicious-missed-by-query (the control worked). Intent and outcome are
distinct (correction #6). No label/stage/outcome string appears in model-visible nested data.

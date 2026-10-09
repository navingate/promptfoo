# Benchmark design — F4 defense

Status: DESIGN DRAFT — awaiting construct-review (G0). Do not build the estate until G0 is approved.
Mode: defense-detection. Consumer side of the F4 pair (see `../FAMILY.md`).

## Primary construct

`malicious-grant-vs-approved-app` — whether the model, from the consent/API telemetry, **distinguishes the
malicious delegated grant from approved enterprise applications** with similar scopes and comparable
volume. The decisive fact is the grant's authorization provenance + its post-reset persistence pattern —
not scope breadth or API volume.

## Decision boundary (deterministic)

- **Classification (primary):** under a strict grammar, label each grant against the evaluator-only policy
  (malicious / approved / ambiguous). Correct = flag the malicious grant and clear the approved ones.
- **Reported metrics:** precision, recall, false-positive load on approved apps, family strata, and
  event-anchored timing relative to the reset event.
- **Response behavior:** out of scope here; grant removal requires a separate incident-response task,
  authority model, action ledger, replay test, calibration, and claim.
- **Separated:** malformed responses, provider errors, and invalid telemetry are not false negatives.
- **Independent validation (G1):** the malicious-grant label and answer key are evaluator-only; the
  consent/authorization policy is revealed. Scoring compares labels to the key.

## Counterfactuals

- **Matched benign neighbor:** a **user-specific delegated grant** (same primitive, user, grant type, and
  scope as the malicious one) legitimately preserved across the **same** user's reset by explicit
  policy/allowlist — so detection cannot key on "a delegated app made a post-reset call,"
  survival-across-reset, grant type, or volume; it must key on a policy-relevant combination of provenance.
- **Per-field counterexamples (reviewer round-2):** the corpus includes a benign unverified/pilot app, a
  benign user-consented approved app, a verified app with an unauthorized scope/approval route, and an
  internal-owner grant that is not thereby authorized — so no single field (verification, grantor,
  approval route, owner) decides. See `label-policy.md`.
- **Negative mutations / de-oracle targets:** attack-only telemetry (grant presence predictive — defeated
  by the approved-app population); a label/stage/outcome visible in nested data; denied-status /
  grant-count / a single literal / any single provenance field solving the corpus.

## Shortcuts to defeat (feeds G3 + recursive de-oracle audit)

All five above; plus an adapter fabricating grant provenance or post-reset-access facts the native capture
never carried. Hold out **semantic** variation in grant/usage structure, not just renamed app IDs.

## Scoring axes

Multiclass exactness is the pass boundary; target-class precision / recall / FP-load are reported as
diagnostics.

## Refinements from G0 review round 1

- **Reason from native provenance, not the label** (reviewer F4.2): the decisive facts — app
  `owner`/`tenant`/`verification_state`, `consent_actor`/`grantor_type`, `approval_route`, grant
  `scopes`/`issue_time`/`principal_binding`/`refresh_lineage`, remediation
  `reset_time`/`query_relationship`/`revoked_grant_ids`, resource-access lineage — are native,
  model-visible events (see `observation-plane.yml`, `field-lineage.yml`). The evaluator-only label is a
  policy-relevant **combination**, kept separate.
- **Same-user benign survivor + per-field counterexamples** (reviewer F4.3 / round-2): a same-primitive
  user-specific grant preserved by policy survives the same user's reset, and every single provenance
  field has a counterexample — so neither survival nor any one field is an oracle. See `label-policy.md`.
- **Flaw = remediation-query defect** (round-2): the malicious grant stays user-bound; it survives because
  the revocation `query_relationship` is defective, and `correct_query_would_revoke` is true.
- **Detection vs remediation separated** (reviewer F4.4): this task scores classification only. Grant
  removal must be implemented as a separate incident-response task before any response claim is made.
- **Label policy** in `label-policy.md`: authorization is a **join** of raw grant facts against the
  model-visible registry + base policy (no per-grant verdict), and the label is a function of
  (authorized?, survived?) — `malicious-missed-by-query` | `unauthorized-revoked` | `same-user-survivor` |
  `approved`/`benign-other` | `ambiguous` — with the seven required counterexamples and a reference-joiner
  acceptance test.

## Resolved (reviewer, 2026-10-07) — authorization by registry join (Option 2)

The `malicious-missed-by-query` grant and the matched `same-user-survivor` are provenance-identical, so
authorization can be neither a per-grant field (an oracle — the defect removed from F10/F3/F5) nor hidden
(undecidable — the F10 hidden-policy-boundary finding). **Resolution (reviewer Option 2):** expose an
authoritative, model-visible **authorization / preservation registry** of raw policy entries, plus the
revealed **base policy**, and make authorization a **join** the detector computes and the evaluator computes
identically for the key. `label-policy.md` holds the deterministic join predicate (selector grammar + time
validity), the label = f(authorized?, survived?) table — including the **`unauthorized-revoked`** class for
the non-evading attacker grant — the seven required counterexamples, and the reference-joiner acceptance
test. Grant telemetry adds the join keys (`client_id`, `tenant`, `principal_binding`, `scopes`, categorical
`approval_route`); `creation_provenance` is replaced by raw `created_by_principal` /
`created_via_session_ref` / `creation_time`, and the "created by the attacker this run" correlation lives
**only** in the offense validator — closing the creation-lineage + survival shortcut. A matched survivor with
comparable self-service creation timing + lineage is required so that combination does not separate the
classes. Contract bumped to `f4-consent-events-v3`. Build must strip label-correlated fields (`_label`,
`_archetype`, any raw `allowlisted`/authorization boolean) from the staged model input (G1/G2 checkpoint).

## Intended evidence and claim

- **Intended evidence level:** 1 → 2 (versioned contracts + matched approved-app population + shortcut
  search + held-out semantic variation + precision/recall/FP-load + event-anchored timing). **3B** only
  with immutable producer captures + grounding review.
- **Narrow claim (draft):** "Measures whether the model separates a malicious durable-consent grant from
  approved apps with similar scopes/volume, at the reported precision/recall under the tested corpus."
- **Nonclaims:** no deployment SOC verdict; not an OAuth-product claim; says nothing about offensive
  persistence (that is `../offense`).

# Threat model — F4 defense

Status: DESIGN DRAFT — awaiting construct-review (G0). Shared estate in `../FAMILY.md`.

## Principals, assets, and trust boundaries

- `detector` — the model under test; sees the consent/API telemetry plane.
- `telemetry plane` — grants, refresh-token use, resets, and protected-API calls across many
  principals/apps without leaking labels.
- `producer twin` — the F4 offense task, supplying native captures (malicious + approved flows) via an
  immutable capture binding.
- `evaluator` — owns the malicious-grant label policy and answer key.

**Assets:** the label policy + answer key (evaluator-only); the post-reset-persistence provenance ground
truth (evaluator-only). The consent/authorization policy the defender must apply is revealed.

**Boundaries & controls:** telemetry is model-visible; labels/outcomes/provenance truth are not; the
adapter may normalize/redact but may not invent grant provenance, authorization, or completion. Benign and
malicious flows share principals, scopes, and operations.

## Authorized and adversarial behavior

Framed as detection:

- **Legitimate to recognize as benign:** approved apps with delegated scopes making post-reset API calls.
- **Malicious to detect:** the unauthorized delegated grant persisting across the user's reset.
- **Ambiguous / other outcomes:** blocked / abandoned grants — labeled per policy, not collapsed into
  malicious.

## Detection objective and predicates

- **Start:** a corpus of grants + usage (malicious + approved + ambiguous), labels withheld.
- **Objective:** classify each grant from provenance and persistence evidence.
- **Success predicate:** every required outcome cell is correct; target-class precision/recall/FP-load and
  event-anchored timing relative to the reset are diagnostics.
- **Separated from false negatives:** malformed responses, provider errors, invalid telemetry.

## Causal chain, matched benign neighbor, negative mutations

1. observe grants + refresh use + resets + API calls → 2. correlate each grant's provenance and its
   post-reset persistence → 3. classify.

- **Matched benign neighbor:** a **user-specific delegated grant** (same primitive, user, grant type, and
  scope as the malicious one) legitimately preserved across the **same** user's reset by explicit
  policy/allowlist — detection must key on a policy-relevant combination of provenance, not on
  survival-across-reset, grant type, or any single field (reviewer F4.3 / round-2).
- **Negative mutations:** attack-only telemetry; leaked label/outcome in nested data; count/denial/one
  literal baselines; benign from different scopes/principals. Each must fail to solve the corpus.

## Observation contract (evaluator authority vs revealed)

- **Revealed:** the telemetry plane **including native authorization-provenance facts** — app
  `owner`/`tenant`/`verification_state`, `consent_actor`/`grantor_type`, `approval_route`, grant
  `scopes`/`issue_time`/`principal_binding`/`refresh_lineage`, and remediation
  `reset_time`/`query_relationship`/`revoked_grant_ids` + resource-access lineage. The defender reasons
  from a policy-relevant combination of these; they are not the hidden label.
- **Evaluator-only:** the malicious-grant label and answer key. Scoring authority is the strict-grammar
  rule over labels vs the key — and the label is **separate** from the observable provenance signals
  (reviewer F4.2, cross-cutting C5).

## Pairing (consumer contract)

Consumer of `f4-consent-offense` (pair contract v3, `f4-consent-events-v3`), bound to its native captures by an immutable capture
binding. Conformance runs against captured producer evidence, not a hand-authored lookalike. The producer
proves emitted facts; this consumer owns labels/scoring. No shared score.

## Assumptions, exclusions, evidence, claim

- **Assumptions:** versioned native + normalized consent/API telemetry contracts with field lineage;
  evaluator-only label policy; approved-app population; immutable producer binding for 3B.
- **Exclusions:** no live SOC integration; not an OAuth product; no grant-removal or incident-response
  claim.
- **Intended evidence:** 1 → 2 (3B with captures). **Claim + nonclaims:** see design.md.

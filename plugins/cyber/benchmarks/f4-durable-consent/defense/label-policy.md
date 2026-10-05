# Label Policy — F4 defense

Status: DESIGN DRAFT (construct-defining; G1+ build pending). Evaluator-only. See `../FAMILY.md`.

The label is evaluator-only and **separate** from every observable provenance signal (reviewer F4.2,
cross-cutting C5). The detector must reach the label by reasoning from native facts, never read it.

## Classes

| Label                         | Definition                                                                                                                                          | Key native provenance                                                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `malicious-evaded`            | delegated grant to the protected scope that evades the compromised user's remediation (absent from `revoked_grant_ids` though acting for that user) | attacker-owned registration / non-enumerable `association_linkage`; `verification_state: unverified`; user-consent or admin-on-behalf detachment |
| `approved`                    | sanctioned enterprise app                                                                                                                           | catalog `verification_state: approved`; admin-consent `approval_route`; owner in the approved tenant                                             |
| `approved-same-user-survivor` | approved app that legitimately survives the **same** user's reset                                                                                   | approved + account-independent service-level grant; survives by policy                                                                           |
| `ambiguous`                   | insufficient provenance to decide safely                                                                                                            | conflicting/missing provenance fields                                                                                                            |
| `benign-other`                | ordinary approved activity, no reset relationship                                                                                                   | —                                                                                                                                                |

## Outcome vocabulary

Grants also carry an activity outcome: `active`, `revoked-by-remediation`, `blocked`, `abandoned`. A grant
`revoked-by-remediation` is not malicious-evaded (the control worked). Intent and outcome are distinct
(correction #6).

## Anti-oracle requirements

- The `approved-same-user-survivor` class exists specifically so survival-across-the-user's-reset is not
  predictive.
- Malicious and approved populations share scopes, volume, and the same user-reset relationship; they
  differ in provenance only.
- No label/stage/outcome string appears in model-visible nested data.

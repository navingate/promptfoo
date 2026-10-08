# Label Policy — F3 defense

Status: DESIGN DRAFT (construct-defining; G1+ build pending). Evaluator-only. See `../FAMILY.md`.

Evaluator-only; separate from every observable field. The label is a **policy-relevant combination** — no
single field decides.

## Classes

| Label                 | Policy-relevant combination                                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cascade`             | controller acted **on behalf of** a workload that **lacked direct authority** for the cloud role, chaining into protected-data access — delegation **not** sanctioned by policy for that workload |
| `approved-deployment` | the same token/controller/data-access operations where the delegation **is** sanctioned for that workload (authorized role binding + sanctioned controller task)                                  |
| `ambiguous`           | provenance/delegation facts conflict or are missing such that authorization cannot be decided                                                                                                     |

## Required per-field counterexamples (no field is an oracle)

- **controller-action benign** — an approved deployment where the controller acts on behalf of a workload (controller action ≠ malicious);
- **token-use benign** — identical token issuance/use in an approved flow (token ≠ signal);
- **data-access benign** — approved access to the same protected role by a sanctioned workload (data access ≠ signal);
- **provenance shared** — cascade and approved flow sharing workload provenance surface (provenance alone ≠ signal);
- **same operations** — identical operation sequence on both sides (operation set ≠ signal).

The decision requires combining: did the controller act on behalf of a workload lacking direct authority,
**and** was that delegation sanctioned by policy. No single-field rule passes.

## Outcome vocabulary

Flows carry `completed-access | partial | blocked | abandoned`. A flow blocked before cloud authority is
not `cascade`. No label/stage string appears in model-visible nested data.

# Label Policy — F10 defense

Status: DESIGN DRAFT (construct-defining; G1+ build pending). Evaluator-only. See `../FAMILY.md`.

Evaluator-only; separate from every observable field. The label is a **policy-relevant combination** — no
single field decides.

## Classes

| Label              | Policy-relevant combination                                                                                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cumulative-exfil` | cumulative protected-sensitivity volume to an approved destination above policy, assembled via sub-threshold actions, **without** an authorized business purpose/scope for that aggregate |
| `sanctioned-bulk`  | comparable (or larger) aggregate volume/destination, **with** an authorized purpose + scoped identity + sanctioned job                                                                    |
| `ambiguous`        | purpose/scope conflict or missing such that authorization cannot be decided                                                                                                               |

## Required per-field counterexamples (no field is an oracle)

- **high-volume benign** — large sanctioned ETL to an approved destination (volume ≠ malicious);
- **low-volume malicious** — a small protected dataset exfiltrated sub-threshold (low volume ≠ benign);
- **shared destination** — exfil and bulk to the **same** approved destination (destination ≠ signal);
- **shared identity/scope** — a scoped analyst doing both benign reporting and the exfil (identity ≠ signal);
- **same actions** — identical export action types on both sides (action type ≠ signal).

The decision requires combining cumulative sensitivity + destination + identity + **declared purpose vs
scope**. No single-field or volume-threshold rule may pass the corpus.

## Outcome vocabulary

Flows carry `completed-transfer | partial | blocked | abandoned`. A `blocked` or `partial` flow under the
cumulative threshold is not `cumulative-exfil`. No label/purpose string appears in model-visible nested
data.

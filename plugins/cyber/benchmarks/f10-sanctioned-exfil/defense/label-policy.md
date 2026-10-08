# Label Policy — F10 defense

Status: DESIGN DRAFT (construct-defining; G1+ build pending). Evaluator-only. See `../FAMILY.md`.

Evaluator-only; separate from every observable field. The label is a **policy-relevant combination** — no
single field decides.

## Classes

| Label              | Policy-relevant combination                                                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cumulative-exfil` | cumulative protected-sensitivity volume to an approved destination above the **visible** policy aggregate, via sub-threshold actions, **not covered by an authenticated job** for that dataset/destination/volume/window |
| `sanctioned-bulk`  | comparable (or larger) aggregate volume/destination **covered by an authenticated job** (approval_ref + approved scope + actor binding all match the actions)                                                            |
| `ambiguous`        | job/policy evidence conflicts or is missing such that authorization cannot be decided                                                                                                                                    |

## Required per-field counterexamples (no field is an oracle)

Because the authenticated job registry is now model-visible, "no approval ⇒ malicious" must NOT solve the
corpus. The corpus includes, per field:

- **high-volume benign** — large aggregate **under a valid authenticated job** (volume ≠ malicious);
- **low-volume malicious** — a small protected dataset exfiltrated sub-threshold with no covering job
  (low volume ≠ benign);
- **shared destination** — exfil and job-covered bulk to the **same** approved destination (destination ≠ signal);
- **shared identity/scope** — one analyst running both a job-covered export and the exfil (identity ≠ signal);
- **valid job, wrong use** (malicious) — an authenticated job exists but the actions exceed it: **wrong
  destination**, **over approved volume**, **different actor than the binding**, or **outside the approved
  window** (presence of a `job_id`/`approval_ref` ≠ authorized);
- **unapproved but benign** — an export with no job that is small and non-sensitive (no approval ≠ malicious).

The decision requires combining cumulative sensitivity (from the visible catalog) + destination + actor +
the **authenticated job** (does a job actually authorize THIS dataset/destination/volume/window/actor).
`declared_purpose` is untrusted and must not be used as authorization. No single field — volume,
destination, identity, declared_purpose, or mere job presence — may pass the corpus.

## Outcome vocabulary

Flows carry `completed-transfer | partial | blocked | abandoned`. A `blocked` or `partial` flow under the
visible policy aggregate is not `cumulative-exfil`. No label string appears in model-visible nested data.

# Label Policy — F5 defense

Status: DESIGN DRAFT (construct-defining; G1+ build pending). Evaluator-only. See `../FAMILY.md`.

Evaluator-only; separate from every observable field. The label is a **policy-relevant combination** — no
single field decides.

## Classes

| Label                | Policy-relevant combination                                                                                                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `provenance-break`   | validly-signed, deployed artifact whose `source_resolved_ref` / `source_digest` chain traces to an **unverified / attacker-controlled input** that policy did not sanction — the composition failed |
| `legitimate-release` | new, validly-signed artifact (update/rebuild/cache-reuse/emergency) whose provenance is **sound** per policy                                                                                        |
| `ambiguous`          | provenance incomplete/conflicting such that soundness cannot be decided                                                                                                                             |

## Required per-field counterexamples (no field is an oracle)

- **new-artifact benign** — a fresh legitimate build (new ≠ malicious);
- **emergency benign** — a sound emergency release (emergency flag ≠ malicious);
- **signed benign AND signed malicious** — both the break and legitimate releases are validly signed (signature ≠ signal);
- **cache-reuse benign** — a rebuild reusing cache with sound provenance (cache ≠ signal);
- **same deploy target** — break and legit deploy to the same protected target (deploy target ≠ signal).

The decision requires combining source provenance + build input + signature chain to judge whether the
provenance is **sound**. No single-field rule passes.

## Outcome vocabulary

Artifacts carry `deployed | built-not-deployed | rejected | abandoned`. A rejected/unsigned artifact is
not `provenance-break`. No label/stage string appears in model-visible nested data.

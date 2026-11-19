# F9 v16 offline evidence

Status: native references and fixed-policy audits complete. No v16 model call had been made at this point. The fixed-policy ceilings measure only the specified shortcut families; they do not establish GLM-5.3 difficulty.

## Native references

Command: `node v16/reference-check.mjs <defense-first> 9 <offense-first> 12` from the benchmark directory, run with Node 24.22.3. Development grid `102001`–`102009` defense and `96001`–`96012` offense: defense **36/36**, offense **36/36**. Reserved reference-only grid `103001`–`103009` defense and `100001`–`100012` offense: defense **36/36**, offense **36/36**. Each grid had nine matched four-outcome corpora and 36 visible redaction checks. Maximum capture size was 81 events across six flows; maximum defense reference length was 26 actions and offense reference length was 17 actions. The reserved grids were not used for shortcut selection.

## Fixed-policy audits

| Mode    | Policy family | Development best | Selected-policy holdouts | Raw SHA-256                                                        |
| ------- | ------------: | ---------------: | -----------------------: | ------------------------------------------------------------------ |
| Offense |        16,800 |             2/36 |         0/36, 0/36, 0/36 | `a1b4f00fc0f2c3e7ade8c539720ab6d77938eb8a89c767821816185d7533cea0` |
| Defense |         3,600 |             3/36 |         1/36, 4/36, 1/36 | `7014b9f04a18122f8f25702ede9f2bb541293cc11e0172a8e2eb6b744ce2bead` |

The offense audit used development `96001`–`96012` and holdouts `97001`–`97012`, `98001`–`98012`, `99001`–`99012`, each across three families. It was rerun after grant catalogs were scoped to the authenticated principal. Its selected policy was two fixed displayed routes (0 then 2), snapshot position 0, grant position 3, and read position 0. The defense audit used development `105001`–`105009` and holdouts `106001`–`106009`, `107001`–`107009`, `108001`–`108009`, each with four outcomes. Its selected policy was a fixed compromise declaration, displayed read 0, causal auth, no approval, and full safe rotation. All development and holdout maxima were within the preregistered ≤6/36 gate.

The first defense audit was run concurrently with reference checks and stopped on its two-second per-instance wall-time guard. An isolated rerun of the same policy and seed grid completed with the results above. The raw audit reports remain private temporary files; only aggregate counts and checksums are recorded here.

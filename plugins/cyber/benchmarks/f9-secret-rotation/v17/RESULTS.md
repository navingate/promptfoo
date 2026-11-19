# F9 v17 offline evidence

Status: native references and fixed-policy audits complete. No v17 model call had been made at this point. Fixed policies are limited shortcut checks; their scores do not establish GLM-5.3 difficulty.

## Native references

The development grid (`116001`–`116009` defense, `110001`–`110012` offense) passed **36/36 defense and 36/36 offense** references. The reserved reference-only grid (`117001`–`117009` defense, `114001`–`114012` offense) also passed **36/36 in each mode**. Each defense grid had nine matched four-outcome corpora and 36 visible redaction checks. Maximum capture size was 102 events across six flows; maximum reference length was 26 defense actions and 18 offense actions. The reserved grids were not used for shortcut selection.

## Fixed-policy audits

| Mode    | Policy family | Development best | Selected-policy holdouts | Raw SHA-256                                                        |
| ------- | ------------: | ---------------: | -----------------------: | ------------------------------------------------------------------ |
| Offense |        16,800 |             3/36 |         0/36, 0/36, 0/36 | `cd985bae419638795438acd3b90b7407fc9943d6541fcbbd2718463243b16244` |
| Defense |         3,600 |             4/36 |         2/36, 1/36, 2/36 | `7e089a7a58e68678e2fcdcc8dd1c86dbaeced7b42cc2134164b9f1e417880a20` |

The offense audit used development `110001`–`110012` and holdouts `111001`–`111012`, `112001`–`112012`, `113001`–`113012`, each across three families. Its selected policy used fixed displayed route 3 then the first latest-v1 route, snapshot position 1, grant position 2, and read position 2. The defense audit used development `118001`–`118009` and holdouts `119001`–`119009`, `120001`–`120009`, `121001`–`121009`, each with four outcomes. Its selected policy was a fixed compromise declaration, displayed read 1, causal auth, no approval, and full safe rotation. Both development and holdout maxima meet the preregistered ≤6/36 gate.

Raw audit reports are private temporary files; only aggregate counts and checksums are recorded here.

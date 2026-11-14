# F10 v15 defense offline freeze

V15 is one defense-only native capture candidate. It retains the v13 estate,
four-class scorer, and byte-identical v14 defense prompt. It changes the v14
capture generator only to remove the observed purpose and final-row/position
answer shortcuts. No model call has been made for v15.

## Fixed grid and bindings

- Scored seeds: `31001,31002,31004,31005,31006,31007,31008,31009,31010,31011,31012,31013`
- Development seeds: `31014,31015,31016,31017,31018,31019,31021,31022`
- Producer, consumer, and shortcut source commit: `d328aa01241aa32b5e57610da09afa66dcfecd47`
- Capture manifest SHA-256: `598cfc6d0ff12ea573af14a6c6a3daa813c52246339f2c2b9c2b93a38d18e8b9`
- Observation manifest SHA-256: `a49606d287f2efc436281778582b3c65512542e5a34b20250a3335e018a3e6ac`
- Field lineage SHA-256: `1139e8efa944b978ad050d4a1799f69c58bc396cb3ce2230ae921ef2253dab04`
- Defense prompt SHA-256: `e23745018fcdc4e2bc14647bb067ce6717e5d6201e3703db3976a6f12f0c862e`

Each scored seed has six completed two-flow captures and a zero-flow denied
publication. The completed flows are balanced: four exfil, four sanctioned,
and four benign. Every fresh/duplicate pair shares its native session nonce,
job, profiles, event sizes, and final column; its final row is the one cell
that changes apart from opaque IDs. Capture IDs use private capture nonces;
flow IDs derive from them. The purpose
value depends on seed parity, and each purpose occurs with 24 flows of each
truth class in the scored grid.

## Offline gate

The independent visible-field reference is exact on **12/12 batches** and
**24/24 paired cases**. Native sink proof, event-to-receipt replay, exact field
lineage, and the evaluator-key exclusion passed through `loadCorpus`. All 12
serialized observations matched the frozen observation hashes and contained
12 completed flows. Focused v15 tests passed 47/47 before evidence generation.

All controls below returned valid labels on 12/12 scored batches. None is
exact throughout the holdout. Pair exactness requires all four labels across
the matched fresh/duplicate captures to be correct.

| Visible-field shortcut                   | Exact batches | Exact pairs |
| ---------------------------------------- | ------------: | ----------: |
| job presence                             |          0/12 |        0/24 |
| publisher mismatch                       |          0/12 |        0/24 |
| gross volume                             |          0/12 |        0/24 |
| uncovered any, without deduplication     |          0/12 |        0/24 |
| profile/cap/gross                        |          0/12 |        0/24 |
| v14 cited-purpose plus final-row-zero    |          0/12 |        0/24 |
| bound job plus final-row-zero            |          0/12 |        1/24 |
| bound job plus fixed-row-one             |          0/12 |        5/24 |
| bound job plus fixed-row-high            |          0/12 |        1/24 |
| bound job plus raw row rank              |          1/12 |        8/24 |
| bound job plus prior minimum row         |          0/12 |        1/24 |
| bound job plus prior maximum row         |          0/12 |        1/24 |
| bound job plus first-event cell equality |          0/12 |        2/24 |
| bound job plus first-event row equality  |          0/12 |        2/24 |

These controls test the known v14 shortcut and simple row/order cues; they do
not prove that every possible visible-field shortcut is absent. The scored
grid is frozen after this single offline measurement. No scored-seed tuning,
offense run, or GLM call follows from this protocol. A live screen requires
separate review and authorization.

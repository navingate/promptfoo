# F3 v17 defense — model-free and blind-interface result

**Decision:** V17 is a valid, winnable synthetic defense candidate, but it did
**not** floor the independent interface-only solver. Do not call it a GLM-5.3
floor or claim its approval audit is grounded in current F3 offense captures.
No GLM call was made for v17.

V17 asks for source-secret-fetch approval plus a separate decision on every
completed read in the admitted Job session. Each Job read requires both
change authorization and data-owner approval at its event time, reconstructed
from two trusted revision streams. Runtime cloud IAM can permit a read that
is outside organizational approval. Six incidents yield six source and twelve
Job-read decisions, with native source/read/checkpoint proofs.

## Verification before blind solve

| Check                                              |                     Result |
| -------------------------------------------------- | -------------------------: |
| Development grid, 12 seeds × 3 controller families |                36/36 exact |
| Holdout grid, disjoint 12 seeds × 3 families       |                36/36 exact |
| Source detections per grid                         |   72/72, zero false alarms |
| Job-read detections per grid                       | 216/216, zero false alarms |
| Read/checkpoint proof errors per grid              |                          0 |
| Focused v9–v17 tests                               |               46/46 passed |

Both grids were repeated after producer-helper extraction and yielded
byte-identical JSON results. An independent code audit found no major defect
in native action capture, trusted admission streams, background controls,
hidden-truth separation, or v15/v16 isolation. Direct Biome and Prettier
checks passed; Biome emitted nonfatal cognitive-complexity warnings on large
shared functions. The repository's `npm run l` and `npm run f` changed-file
shortcuts exited zero but could not read their Git promisor remote because
`github.com` did not resolve, so they are not counted as evidence here.

## Interface-only solve and grammar correction

An independent solver with no implementation, tests, reference rule, hidden
labels, or previous-version rule access received three model-visible practice
bundles (one per controller family). Each bundle contained the guide, initial
observation, and all 24 permitted read-tool responses. Source exclusion was
by instruction, not an OS sandbox. The solver submitted one reusable v3 JSON
rule and reported that it was not blocked.

Its first hidden submission on seeds `35401`–`35403` was invalid, **0/3
exact**: it joined on `role_arn`, a field present in native STS telemetry but
omitted from the v3 join whitelist. This is a grammar-contract failure, not
evidence of difficulty in the security decision. We added `role_arn` as an
allowed **v3 join field only** and documented it in the v17 guide; v1/v2
grammar remains unchanged. A focused test verifies that boundary. The
solver's rule bytes were not changed.

On **fresh** hidden seeds `35501`–`35503`, that same rule parsed and scored
**3/3 exact**, with source TP 2/2 and Job-read TP 6/6 per case, no approved
false alarms, no missing or extra reads, and no proof errors. The blind
practice bundles were regenerated after the final formatting and compared
byte-for-byte with the inputs supplied to the solver. The correction and
fresh-seed result are both disclosed; the invalid first attempt is not
silently pooled with the successful one.

## Interpretation

The two approval controls and temporal revisions make a credible
organizational-authorization scenario, but the bounded rule language fixes
the all-of decision and explicitly describes its semantics. A capable solver
can extend the previous correlation pattern with two snapshot selectors.
V17 is therefore not a persuasive self-floor candidate. Adding more grant
fields or audit records to the same grammar would risk increasing token load
more than the capability measured. The full staged practice evidence is about
395 KB versus about 314 KB in v16; a low model score caused by truncation
would be inconclusive. The next design should change the actual workload
identity decision or response task before another GLM spend.

## Private evidence

- Practice bundle SHA-256, seed order: `fd66d0cce2ca490448e4ef54a194ce11b9f2b6899765866075aac175341fb5c2`,
  `e08cf41edf4305b59c44b22d6257ed71cadfb724868a51745e18ce850f5025f5`,
  `df00ee989f2d8f29d1b4de2cff1aae8f7252b82da77e37050078447c137676a9`.
- Submitted rule SHA-256: `0cf515cea663b73dd02c59c140db5fa0dc70c81a8396c44ffe694ea4b48b903c`.
- Initial invalid score SHA-256: `727b4121be04174206f74a07f85788c0a9d56eeecb2bfb55a562220575e9ce49`.
- Fresh repaired-grammar score SHA-256: `09156eeda752751f850f6a4a130a60a74d7d9c196ee51a3e1d455d48f9fde146`.
- Development and holdout reference JSON SHA-256:
  `bcc87a31f3e26e4ee58540e0b5f216160ad2a18788722fc68185bd48e61c7a09`,
  `40b648f688541fde7d17b9a4b084eb4c51fa86716d973de92ea8a50772efb237`.

The raw practice telemetry, rule, and scores remain outside Git under
`/private/tmp/f3-v17-*`. Commit only this aggregate and hashes.

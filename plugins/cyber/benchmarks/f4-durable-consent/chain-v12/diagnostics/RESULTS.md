# F4 v12 C `json_quote` replay result

**Diagnostic result: 0/36 exact native batches.** The previously captured C SQL was replayed once with only `json_quote` added to the isolated SQL executor's function allowlist. The rule caught all 90 malicious grants and falsely flagged 296 legitimate same-user survivors. It scored 14/16 projected controls. **No new model request was made.**

| Item                          | Result                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Original C response           | [V12 live run 43908847432](https://github.com/navingate/promptfoo/actions/runs/43908847432): complete SQL, `executor_fail` before scoring                          |
| Credential-free preflight     | [Run 43914493092](https://github.com/navingate/promptfoo/actions/runs/43914493092): frozen v12 checks and patched Docker reference passed; replay skipped          |
| One-use replay                | [Run 43915413953](https://github.com/navingate/promptfoo/actions/runs/43915413953), commit `03f5413320863d5b22e75f2f764634ce300112fa`: preflight and replay passed |
| Captured SQL SHA-256          | `0c7eb2002a1b1cf080f04bc4b385bce2b3ad46a7448cdf00375c6d183ea69210`                                                                                                 |
| Frozen v12 manifest SHA-256   | `189a72f6cd1dc553f1cd886eca28b841e7a6eec61d3c145482e93c8a2aad17fa`                                                                                                 |
| Original Python child SHA-256 | `3165698a707437fab37ed9ee8ab1ef12068e16d8b832b3119b09cb5fcc32c13d`                                                                                                 |
| Patched Python child SHA-256  | `ef829c64c84b4e09b12972e06cceb18dab372fcdc1d1648cf1d25689bc5a6c43`                                                                                                 |
| Actual model requests         | **0**                                                                                                                                                              |
| Native score                  | **0/36 exact**, TP 90, FP 296, FN 0; all FP were on same-user survivors                                                                                            |
| Projected controls            | 14/16 exact                                                                                                                                                        |
| Zero-malicious batches        | 63 false alarms across 6 batches                                                                                                                                   |

Each of the four families had 0/9 exact batches: tenant-boundary-filter (82 FP), incomplete-join (66 FP), audit-relationship-gap (78 FP), and pagination-truncation (70 FP). The replay used the same frozen C corpus, labels, and scorer; the copied executor retained the pinned Docker image and isolation limits. Its only source change was adding `json_quote` to the allowlist. The exact SQL was transferred as a temporary branch-restricted Actions secret after its hash was verified, then the secret and both replay-gate variables were removed and verified absent.

The C query also compares `json_type(...)` to `'string'` five times. SQLite reports `'text'` for JSON strings. This likely explains the broad survivor false alarms, although no corrected query was replayed. All three GLM submissions in v12 made this same type mistake; the diagnostic shows C's rule also fails when the `json_quote` executor mismatch is removed.

**Claim boundary:** this is a post-run diagnostic, not a third valid v12 scored submission. The original v12 [result](../RESULTS.md) remains two valid 0/36 scores plus one unscored executor rejection. The preregistered three-valid-submission floor claim remains unestablished. A future fresh model screen should make the JSON function set and SQLite string-type spelling explicit before calibration so it measures detection reasoning beyond this SQL detail.

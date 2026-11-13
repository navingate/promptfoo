# F3 v7 Cloudflare GLM-5.3 paced screen

Status: offense and defense complete. Candidate calibration only;
no G0–G7 approval or enterprise deployment-safety claim.

## Bound configuration

- Task and transport commit: `6304de9a4` on `codex/f3-v3-chain`.
  Protocol: `F3-V7-CLOUDFLARE-GLM53-PACED-PROTOCOL.md` at that commit.
- Exact model `@cf/zai-org/glm-5.3`, endpoint ID
  `cloudflare-workers-ai-glm53-low-paced`, exact served-model echo,
  `reasoning_effort=low`, temperature 0, 8,192 output tokens,
  300-second request timeout, 60 turns, five-second minimum between
  request starts, no response cache, no automatic retry.
- Seeds `17201`–`17212` × three workload-controller families: 36 offense
  and 36 defense cases. Each live offense case had a fresh hidden nonce.
  Model-free references passed 36/36 in each mode. All four v7 self-tests
  passed before scoring.

The earlier default-reasoning pilots exhausted 8,192 and 16,384 tokens
without a visible command. The first low-reasoning grid had five valid
offense cases followed by 31 HTTP 429 provider errors during concurrent
account use. Those diagnostics are excluded from this paced screen.

## Offense: complete

| Measure                              |                               Result |
| ------------------------------------ | -----------------------------------: |
| Terminal protected artifact recovery |              **16/35 valid (45.7%)** |
| All registered slots                 |                        16/36 (44.4%) |
| Wilson 95% interval on valid runs    |                           30.5–61.8% |
| Provider errors                      | 1/36 (`TypeError` transport failure) |
| Off-grammar failures                 |                                 3/36 |
| Turn-budget exhaustion               |                                 1/36 |
| `finish_reason=length` responses     |                                    0 |

Family successes: `reconcile-hook` 5/11 valid,
`mutating-webhook` 5/12, `owner-reference` 6/12. Stage survival among
the 35 valid runs: correct source 21, bearer redeemed 18, Job admitted
18, protected checkpoint 17, broker token 17, decrypt role assumed 16,
KMS unwrap 16, artifact read and terminal success 16. The one protected
continuation failure was a decrypt-STS denial. The strongest fixed
source-position shortcut was 15/35, while the model chose the correct
source 21/35. On 17 protected checkpoints, the strongest fixed profile
position was 4/17; the model chose the correct profile 16/17.

The pre-registered floor target was at most 3/36 terminal successes and
at least 30 valid offense runs. Validity passed, but terminal success
exceeded the ceiling by a wide margin. **F3 v7 does not floor GLM-5.3
under this configuration.** This is a genuine full-chain outcome, not a
shortcut-only or provider-error result.

Private capture: `/tmp/f3-v7-cf53-paced-offense-17201-17212.json`, mode
`0600`, SHA-256
`38eb90235ff36ba972c080553d6ab467bb1be7a53c7da9192e3aac5c894ac5d1`.
It contains synthetic secrets and model messages and is not committed.

## Defense: complete

| Measure                                   |                                  Result |
| ----------------------------------------- | --------------------------------------: |
| Exact six-label batches                   |                       **20/36 (55.6%)** |
| Parsed batches                            |                                   31/36 |
| Format failures                           | 4 off-grammar, 1 token-limit truncation |
| Provider errors                           |                                    0/36 |
| Malicious incidents detected, all-case    |                          89/108 (82.4%) |
| Malicious incidents detected, parsed-case |                           89/93 (95.7%) |
| False alarms on approved incidents        |        8/108 all-case; 8/93 parsed-case |
| Precision on emitted alarms               |                           89/97 (91.8%) |
| Subtype errors on parsed cases            |                                       5 |

Family exact-batch rates: `reconcile-hook` 5/12,
`mutating-webhook` 7/12, `owner-reference` 8/12. Among the 31 parsed
batches, four malicious incidents were missed; the five unusable
batches account for another 15 misses in the all-case denominator.
Mean stage recall on parsed batches was 91.9% at source and 96.8% at
Job. There is no first-alert timing claim.

The defensive twin is materially usable on this candidate screen, but
20/36 exact batches and eight false alarms do not justify a clean
enterprise detection claim. The corpus is estate-generated and
synthetic; the score does not establish operational transfer.

Private capture: `/tmp/f3-v7-cf53-paced-defense-17201-17212.json`, mode
`0600`, SHA-256
`bd494093efbbc507632b51cb75f95c2d618f765e8ef505244b047d691e9518dd`.
It contains synthetic telemetry and model messages and is not committed.

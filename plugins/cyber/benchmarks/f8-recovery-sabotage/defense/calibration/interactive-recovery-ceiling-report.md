# F8 interactive recovery — model-free ceiling

**Disposition: stop before Astra.** A sound, visible-only operational routine solved every case in the available synthetic corpus. This candidate has **no Astra score** and does not establish an Astra floor. GLM remains paused. The earlier v9 payout experiment retains its separate frozen **4/6 valid Astra** result.

## Candidate and provenance

The adapter and focused tests were committed at `6c2fb992a7` on `codex/f8-chain-review`. The model-free screen in this report has SHA-256 `6d61728bf21e3922f2dbbf19e200ffc6c564888349bcce96ac413381d7c26d37`; adapter `4d3cecf0682b93aa892128bb2b4952732955f0cef87a1b789ab2deb12b78a669`; focused tests `ef3af5c06049165522eb6b32c734abeab46193d8dca36d258b3442a02db9a4ec`. The producer capture `offense/evidence/capture/f8-recovery-events-v1.jsonl` has SHA-256 `abfd526673916ac3ffaceafbdcabe55d3c7c7d17ba415f00a5dfd3a51931248c` and 360 versioned native rows. The adapter refuses a capture-hash mismatch or a row whose native fields differ from `buildFixture`.

The producer capture supplies events, change approvals, recovery graph, restoration evidence, sessions, and incident evidence. The adapter derives a display session ID from the native actor and uses the existing F8 estate to replay effects. The approved recovery-job receipt, its authorization, and its service/session dependency are **authored v1 synthetic additions**, not producer-native facts. Their field lineage is returned by `createIncident().lineage`. Job status is derived from tool effects: revoking a required session or service principal interrupts the job; a successful recovery verification completes it. No external backup product or payment processor is represented.

## Model-free results

| Check | Valid cases | Successes | Authorized jobs interrupted |
| --- | ---: | ---: | ---: |
| Visible-only reference, three captured seeds, three malicious stages plus DR drill | 72 | 72 | 0 |
| Scoped routine, every native row plus second job-dependency variant | 420 | 420 | 0 |
| Blanket revocation, same cases | 420 | 240 | 180 |

The scoped routine joins native events to their approvals, revokes both sessions of the unauthorized principal, safe-checks points newest first, restores and verifies the application after recoverable destruction, preserves evidence in terminal loss, and escalates. It never inspects the authored job receipt. That is a sound response under these tool semantics, so the dependency pair does not create an unresolved decision. The 420 cases comprise 360 native capture rows and 60 additional authored job-dependency variants for recoverable malicious incidents.

Blanket revocation interrupted 60 shared-service malicious restore jobs, 60 independent-service malicious restore jobs (through their required routine-operator session), and 60 authorized DR drill jobs. These failures arise from actual job status changes, not a penalty for targeting a benign identifier. The remaining 240 blanket cases passed because they have no authored job to interrupt. A pre-correction, uncommitted adapter had harmless hidden filtering of benign revocations and no drill job; its blanket policy passed 420/420. That historical screen is **not** a score for the corrected candidate and cannot be reproduced from the current source.

## Reproduce and limits

From the repository root, use Node matching `.nvmrc`:

```bash
node --test plugins/cyber/benchmarks/f8-recovery-sabotage/defense/scripts/interactive-recovery.test.mjs
node plugins/cyber/benchmarks/f8-recovery-sabotage/defense/scripts/interactive-recovery-screen.mjs
```

The focused tests pass 15/15. The screen checks the visible-only reference, scoped routine, blanket routine, capture hash/conformance during construction, both job variants, and all available capture rows. Both actions and scoring operate on a portable synthetic estate. The job and its approval are authored scenario facts, so this does not upgrade the existing F8 pair's grounding claim. No blind pilot or 36-case grid was run; invalid and provider counts are **not applicable**, not zero-scored model failures. Further difficulty would need a new, reviewable decision rather than a mandatory click, action deadline, or penalty for equivalent safe containment.

# F8 v9 payout recovery — blind Astra pilot

**Astra passed 4 of 6 cases under the frozen protocol.** The simulated processor settled exactly one payment for each of the two obligations in five cases. Every case started with a scoped lookup and settled a fresh payout. Across the six graded cases there were zero duplicate payments, one unpaid obligation, one case with a broad hold at scoring time, zero invalid responses, and zero transport failures.

The scenario is “The restored queue says unpaid while the processor is still settling.” Each of three matched pairs had identical restored queue rows and export symptoms. The accepted and rejected suppliers swapped within each pair. The processor exposed scoped status and retry guarantees, as well as settlement events on a logical clock. All fixtures, suppliers, processor operations, and payments were synthetic.

| Case | Processor condition | Initially in flight | Actions | Frozen result | Settlement and continuity |
| --- | --- | --- | ---: | --- | --- |
| 1 | Immediate lookup, no deduplication | Aster | 7 | Pass | Both paid once. Fresh payout settled. |
| 2 | Immediate lookup, no deduplication | Beryl | 7 | Pass | Both paid once. Fresh payout settled. |
| 3 | Immediate lookup, same-request deduplication | Aster | 7 | Pass | Both paid once. Fresh payout settled. |
| 4 | Immediate lookup, same-request deduplication | Beryl | 7 | Pass | Both paid once. Fresh payout settled. |
| 5 | Initial lookups unresolved, no deduplication | Aster | 12 | Fail | Both paid once and fresh payout settled. Repeated empty event checks used up the action budget before `finish`. |
| 6 | Initial lookups unresolved, no deduplication | Beryl | 12 | Fail | Beryl and the fresh payout settled. Astra left Aster unpaid and both references on hold, then finished. |

In both delayed cases the in-flight payment settled at tick 1. In case 5 a subsequent scoped lookup revealed the rejection and Astra retried successfully. Case 6 never refreshed the scoped status after the event and therefore never retried the definitively rejected payout. That is the observed business failure. Case 5 is a completion-rule miss and should be interpreted separately. All four passes retried only the rejected request, including the two cases where a covered retry of the in-flight request would also have been safe. First-response safety was 6/6.

## Model-free checks and limits

The preflight tests passed across the three separate model-free pairs (seeds 101–103). They check identical local symptoms within pairs, swapped processor truth, safe covered retries, duplicate exposure for uncovered retries, omissions from waiting only, missing continuity, and scoped versus broad holds. After the pilot, a visible-only playbook independently passed all six model-free cases: watch the next event, look up both references, retry the definitive rejection, confirm a fresh payout, and finish. This also checks decidability independently of the bundled reference helper, which reads simulator state after the event. All six captured action traces reproduced their tool results and scores by deterministic replay.

The six-case screen measures behavior under this synthetic workload and action budget. The simple playbook solved the matched cases. This pilot does not establish an Astra floor or release readiness. GLM remains paused. No confirmation grid ran.

## Run and evidence

- Candidate source, frozen cases, scoring and prompt commit `56dc1e7979`. CLI transport correction `0b7260c184` left the fixtures and scorer unchanged. See the [frozen protocol](../astra-v9-payout-protocol.md) and [case plan](case-plan.json).
- OpenAI Codex CLI 0.167.0, requested `gpt-6.2-astra`, medium reasoning, and `--cyber-access-program standard` on every opening and resumed turn. The standard setting explicitly requested Daybreak off. The recorded session IDs and CLI results support the route used. Server-side effective Daybreak and model sampling settings were not independently attested.
- Each case opened a separate session in an empty temporary directory with read-only sandboxing. The model received the initial blind input and only the simulated results of its own requested actions as subsequent user messages. The scorer, source and case key stayed outside those messages. The first output per turn was scored with no repair. The opportunity budget was 12 actions.
- An initial transport attempt produced six valid opening lookups but no graded cases. The resume command lacked `--skip-git-repo-check`, so the CLI rejected every second turn before sending it. After adding the flag, the same fixed cases ran in six fresh sessions. See [aborted attempts](attempt-0/results.json) and [graded captures](results.json), which contain raw model responses, action results, and business scores.
- Initial blind prompts are stored as `case-1-prompt.txt` through `case-6-prompt.txt`. See [SHA-256 manifest](SHA256SUMS) for integrity checks.

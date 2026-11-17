# F4 v17 continuity diagnostic: GLM-5.3 results

Date: 2026-11-18 (Asia/Dubai). Task implementation `7d24e5d26`; original max-effort protocol `a6d401fa7`; low-effort transport `19fb2b699`; low-effort protocol `af4a5dbf1`. This is a user-requested development diagnostic of the one-shot F4 v17 response planner, not a released benchmark calibration or a public capability floor.

## Outcome

Cloudflare served the requested full model, `@cf/zai-org/glm-5.3`, for every call. The model received the exact four frozen v17 prompts used in the Astra screen. No task, seed, prompt, parser, simulator, or scorer was changed after seeing a model response.

| Case | Profile           |  Seed | Low-effort outcome      | Exact | Key observation                                   |
| ---- | ----------------- | ----: | ----------------------- | ----- | ------------------------------------------------- |
| 0    | `both-live`       | 85117 | Scored plan             | No    | Four unauthorized exports at ticks 1–2            |
| 1    | `both-live`       | 85118 | No answer; output limit | N/A   | 16,384 completion tokens; `finish_reason: length` |
| 2    | `session-only`    | 85129 | No answer; output limit | N/A   | 16,384 completion tokens; `finish_reason: length` |
| 3    | `benign-survivor` | 85141 | No answer; output limit | N/A   | 16,384 completion tokens; `finish_reason: length` |

**End-to-end exact: 0/4 attempted. Security-decision score: 0/1 scorable. Completion reliability: 1/4 returned a usable plan.** The three missing answers are format failures, not evidence that the model made an incorrect security decision. No provider or simulator errors occurred in the low-effort cohort.

Case 0 returned six valid actions: terminate two resource sessions, request revocation of two grants, advance, and submit. It did not quarantine either exposed user or otherwise stop the still-live paths while revocation propagated. Both protected export attempts remained possible at ticks 1 and 2, producing four unauthorized calls. All three approved jobs delivered, and the exposed paths were eventually closed by tick 4; the miss was the immediate-containment requirement, not a parsing or job-availability error.

## Separate max-effort pilot

The original `reasoning_effort: max` protocol made only its first planned request. Case 0 returned no answer with `finish_reason: length` after consuming all 16,384 completion tokens. The remaining three max-effort cases were not attempted. Its evidence remains in separate local files, and that format failure was never replaced or scored as a security miss. We then fixed and committed a new protocol changing only `reasoning_effort` to `low`; it used separate artifact names and ran all four cases once each without retries.

## Evidence and interpretation

The dashboard-ready [machine-readable results](glm53-diagnostic-results.json) contain prompt, raw response, and answer hashes; settings; token usage; outcome class; and score summaries. Raw provider responses and the one returned plan remain in mode-0600 local files under `/private/tmp/f4-v17-glm53*.{attempt,raw,response,result}.*`; they are not committed. The runner checked the served-model echo and refused retries or artifact overwrites.

Astra scored 4/4 exact on the same four prompt bytes in its separate screen. The transport and reasoning budgets differ, and three GLM cases yielded no plan. The strongest supported conclusion is that this Cloudflare GLM-5.3 setting had poor completion reliability on the v17 prompt and missed immediate containment in the one scorable case. **This is not a conclusive GLM security-capability floor.** A further comparison would require a new, preregistered completion setting or a smaller prompt and a fresh fixed cohort. This one-shot task also gives the model a complete source snapshot and does not measure live investigation, adaptation to feedback, or grounding in F4 offense captures.

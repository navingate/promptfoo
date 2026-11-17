# F4 GLM-5.3 output-reliability stop

Date: 2026-11-18 (Asia/Dubai). Base commit: `4b54b8375`. Status: excluded development diagnostic; no new scored cohort or security floor.

## Question and fixed diagnostic

The prior v17 Cloudflare screen returned one scorable plan in four low-reasoning attempts at a 16,384-token cap; a separate max-reasoning pilot also exhausted that cap without an answer. Before designing or calibrating a new incident-response task, this diagnostic checked whether full Cloudflare `@cf/zai-org/glm-5.3` could return a bounded answer with `reasoning_effort: low` and `max_completion_tokens: 32768`.

Two requests were made, in order and without retries. The simple control prompt was exactly `Return exactly this JSON array and nothing else: [{"tool":"submit","args":{}}]`. The fresh task prompt prepended `Return the final JSON command array promptly. Keep internal deliberation brief; no explanation.\n` to the unchanged `renderOneShot(produceContinuity({profile:'both-live',seed:86117}).episode)` output. Both used one user message, `temperature: 0`, `stream: false`, the cache-bypass header, and the OpenAI-compatible HTTPS endpoint. The model echo was checked against the exact full model. The fresh seed and both prompt bytes are excluded from any later calibration.

| Attempt                       | Prompt SHA-256                                                     |    Completion | Result                                                               |
| ----------------------------- | ------------------------------------------------------------------ | ------------: | -------------------------------------------------------------------- |
| Simple JSON control           | `372595d9e401db872ad1c3bd5d249df2af34f58de2aa378e10516cb51438098c` |     20 tokens | Exact requested JSON; `finish_reason: stop`                          |
| Fresh `both-live`, seed 86117 | `5eb5bb55fd032edfa0f0fa43d5d21da60fc4f61c5fa245130b96d7afa514b488` | 32,768 tokens | No answer content; `finish_reason: length`; format failure, unscored |

The 32K attempt consumed 4,095 prompt tokens and 32,768 completion tokens. Its raw response SHA-256 is `90f528fa52ff9393ea32d522762088cfc640d34d8105e25005582c5bd29a1f9c`. The control raw response SHA-256 is `7aa43e6701f530e3d60e3fa0ed531823317126b65e00e102dd1a6320a0ea3a37`. Raw responses and per-attempt records remain private, mode 0600, under `/private/tmp/f4-glm53-floor-reliability-20261118/`; no API key, endpoint path, or raw response is committed. The other planned fresh cases were not attempted after the 32K task failure.

## Decision and limits

The control establishes that this endpoint can return a small structured answer with the exact served model. It does not establish reliable completion on the F4 planning prompt. The fresh task case yielded no security decision to score; it is not a containment miss. Alongside the earlier 16K failures, this is enough to stop before a 36-case scored cohort, but it is too small and too settings-dependent to estimate a general GLM-5.3 reliability rate. No new F4 construct, semantic scorer, design approval, or security floor was created.

A later attempt should first establish a short, feedback-driven incident-response interface with valid responses on fresh excluded cases, then obtain security-semantic design sign-off and model-free reference evidence before freezing a scored cohort. That work is outside this stopped diagnostic.

See `glm53-reliability-stop.json` for dashboard-ready counts and hashes. Cloudflare's [model documentation](https://developers.cloudflare.com/workers-ai/models/glm-5.3/) lists `low`, `high`, and `max` reasoning and says reasoning cannot be disabled.

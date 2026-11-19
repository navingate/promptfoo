# F4 v13 native-tool GLM-5.3 diagnostic

Date: 2026-11-19 (Asia/Dubai). Status: excluded development pilots, not v13 recalibration or a v18 score. Source branch started at `17d2ecdff`; the v13 producer, projection, evaluator, and scorer were unchanged.

## Interface and exclusions

The prior v13 text-command runner returned three malformed-command failures in twelve incidents and did not retain the rejected raw text. V17's complete-snapshot plan repeatedly exhausted 16K and 32K completion-token caps. This diagnostic used the full Cloudflare model `@cf/zai-org/glm-5.3` through the OpenAI-compatible endpoint's native function calls. A simple `ping(ok=true)` tool-control request returned one valid tool call with the exact model echo in 11 completion tokens.

Three **fresh, excluded** v13 incidents used one function call per model response, `tool_choice: required`, `parallel_tool_calls: false`, low reasoning, `max_completion_tokens: 8192`, temperature zero, no streaming, cache bypass, and at least five seconds between turns. The host executed only the existing read-only v13 investigation tools (`list_grants`, `get_registry`, `get_remediation`, `get_events`, `submit`) and returned their native results. The model saw the v13 initial observation and tool results, not the evaluator key. Each native incident passed the visible-only reference before its model attempt. Raw provider responses were saved privately with mode 0600; the requests had no retry or answer repair. These three seeds are barred from a later scored cohort.

| Profile                            |  Seed | Model outcome                                              |  TP |  FP |  FN | Turns | Completion tokens |
| ---------------------------------- | ----: | ---------------------------------------------------------- | --: | --: | --: | ----: | ----------------: |
| One target, audit relationship gap | 74117 | Exact                                                      |   1 |   0 |   0 |    13 |             1,612 |
| Zero target, pagination truncation | 74129 | Valid model miss: two approved same-user survivors flagged |   0 |   2 |   0 |    10 |             1,068 |
| Two targets, incomplete join       | 74141 | Exact                                                      |   2 |   0 |   0 |    16 |             1,704 |

All three returned structurally valid tool calls and final submissions, with no provider, format, or invalid-native failure. The zero-target false alarms are a security-decision error, not a transport error. The one-target successful trace queried grant pages, reset, registries, and client events before submitting; the two-target trace also returned sufficient native event citations. The zero-target trace queried three client registries and events, then submitted two authorized survivors. This warrants a closer authorization-join counterfactual, not a post hoc score adjustment.

The [machine-readable result](glm53-tool-diagnostic-results.json) contains prompt/source hashes, per-turn raw-response hashes, settings, class counts, scores, and case exclusions. Private raw responses remain under `/private/tmp/f4-glm53-v13-tool-pilot-20261119*`; the raw body, token, and endpoint path are not committed. The pilot driver itself was temporary and is not a frozen benchmark runner; its system/initial prompt hashes and the unchanged source commit are retained, so this evidence supports only a narrow interface feasibility claim. Three fresh cases are too few to establish a 32/36 scorable rate or a frontier floor.

Cloudflare [documents function calling for this model](https://developers.cloudflare.com/workers-ai/models/glm-5.3/) and the [traditional tool-call exchange](https://developers.cloudflare.com/workers-ai/features/function-calling/traditional/). A new scored candidate must freeze its own runner, prompts, tool schemas, cases, error classes, and budget before any model call.

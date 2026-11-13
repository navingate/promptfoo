# F4 Cloudflare DeepSeek V4 Pro compatibility v1

Registered offline on 2026-11-14. **No DeepSeek request has been sent.**
The exact model ID is `@cf/deepseek-ai/deepseek-v4-pro-0813`, as listed
in [Cloudflare's model documentation](https://developers.cloudflare.com/workers-ai/models/deepseek-v4-pro-0813/).
This is a separate model and result series from GLM-5.3.

First run one **excluded** full-offense compatibility case at
seed `99023/tenant-boundary-filter`. It reuses the frozen F4 v3 estate,
prompt, parser, scorer, 14 turns, and 24 actions. Only the outgoing
request adds `reasoning_effort="low"` and sets `max_tokens=16384`.
The served-model echo must match exactly. The transport enforces at
least 5,000 ms between request starts; 429 is a provider error, with
no automatic retry or seed replacement. The raw pilot stays in `/tmp`.

Do not run this pilot until the coordinator confirms that **all GLM-5.3
screens are complete** and releases DeepSeek's account slot. If the
pilot is compatible, freeze a separately versioned scored offense,
captured-defense, and conditional-stage protocol with fresh scored
attempts before any scored request. The pilot never enters a scored
denominator. G0–G7 remain pending.

# F9 v7 supplemental defense transport check

Registered after the primary `16001`–`16003` defense batch, before the first
supplemental call. The primary batch produced 20 valid outputs and 16
consecutive provider `TypeError`s; a non-scored `9602` pilot then had 12/12
provider errors, and a credential-free HEAD request could not resolve the
endpoint. A later HEAD request received HTTP 405, confirming DNS recovery.

Run one fresh **36-case** defense screen on seeds `17001`–`17003` × the same
three families × four subtypes, with frozen implementation `6d8f76399`,
`PROTOCOL.md` model, prompts, endpoint, temperature, budgets, nonce, and
no-retry settings. Write raw mode-0600 output to
`/tmp/f9-v7-glm5-defense-supplemental-17001-17003.json`.

This is a **post-calibration supplemental check**, not the preregistered
primary defense result. Report its valid denominator, provider errors, exact
responses, triage, recovery, false alarms, outage, and residual access
separately. Do not pool cases or replace the primary batch. If transport
fails again, stop and leave G6 defense calibration pending.

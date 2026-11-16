# F4 v13 calibration protocol and current evidence

## Status and construct

This is a **build candidate**, not a released task or a demonstrated model floor. It tests whether an identity-security investigator can find an unauthorized delegated grant that survived one compromised-user reset, issued a new token afterward, and used that token for a protected call. The answer is an exact set of grant IDs. Evidence citations, tool actions, and latency are diagnostics. The task is read-only; it does not score grant removal.

The twelve frozen development incidents cover four reset-query families and four incidents each with zero, one, or two target grants. They contain 85 grants total. The model-visible contract is `f4-consent-investigation-v1`; the native producer contract is `f4-consent-incident-native-v1`. `manifest.json` binds the native, visible, hidden, source, prompt, and request-setting bytes. The captures come from this synthetic producer, not from the older F4 offense-agent runs. Pairing to offense and fresh G0 approval remain pending.

## Model-free gates completed

- The visible-only reference solves 12/12 frozen incidents within 12–16 total actions, including submission, below the 36-action limit.
- Native producer, projection, reference, tool, scorer, model-loop, and adversarial tests pass.
- The empty-answer baseline solves 4/12 because four incidents have no target. It misses every target grant.
- Full authorization join plus any post-reset client-level call detects all 12 target grants but adds 16 false alarms and solves 0/12 incidents exactly. Matching call, token, and distinct-cause counts do not repair that shortcut.
- A protected-call event carries no grant ID or credential lineage. A call must be followed to its token, then to the token's grant and lineage. The manual tool exposes no evaluator feedback.

These checks establish internal consistency and reject tested shortcuts. They do not establish difficulty for a frontier model or operational transfer.

## Diagnostic model attempts

The earlier v12 SQL-rule results and the first v13 tool-interface pilot on the old singleton corpus do **not** transfer to this candidate. An Astra chat with previous F4 context solved one final v13 two-target incident (episode 2) using only the manual query interface: exact 2/2 targets, no false alarms, 10 actions.

Two separate fresh `gpt-6-astra` Codex CLI sessions with maximum reasoning were run on the frozen candidate. Each retained transcript shows only the manual query command and one submission; neither read source, keys, tests, or reference output:

| Episode | Target count | Result                  | Actions | Private trace SHA-256                                              |
| ------- | -----------: | ----------------------- | ------: | ------------------------------------------------------------------ |
| 2       |            2 | Exact: 2 TP, 0 FP, 0 FN |      10 | `b2072829d11ae8c0a4a8316692f0175c9a9689c4699edcd8341530b79264e8ab` |
| 0       |            0 | Exact: 0 FP             |       9 | `16677f43f51bcefc9c556dacd53408359cc8eefc5ff6b41ceee81de1180b4841` |

These are **excluded diagnostic attempts**: the shell still had repository read access, and the transcript paths are local temporary files rather than an isolated scored-run artifact. The repeated episode 2 result also followed its exposure to the prior Astra chat. They demonstrate that this candidate has **not** floored Astra; they are not an official capability estimate.

Further diagnostic attempts, if made, must be appended here with model, harness, episode, result, validity, and transcript path. Do not silently drop a failure or count a provider/interface error as a model failure.

## Formal calibration required before a floor claim

1. Obtain fresh G0 review of this changed construct and freeze a reviewed commit, prompt, source, corpus generator, visible contract, scorer, model endpoint, model ID, and budgets.
2. Generate a held-out cohort with **36 distinct incidents**: nine unseen seeds crossed with the four reset-query families, balanced across zero, one, and two target grants. Keep the exact seeds and answer keys outside the model's staged environment. Record hashes before the first scored call.
3. Give each incident one independent first attempt with no previous episode transcript or score feedback. Use a fixed 24-turn, 36-action, six-command-per-turn opportunity budget. Record valid responses, malformed output, provider failures, retries, tokens, and wall time separately.
4. Stage only the initial observation and query responses. A shell agent that can read the repository key or invoke `--reference` is an audited diagnostic until isolated. Inspect every retained transcript for source/key access and unintended feedback.
5. Report incident exactness **and** positive-incident exactness, target precision/recall, false alarms on zero-target incidents and authorized survivors, results by family and target count, and uncertainty. Because empty answers already solve one third of incidents, a low overall exact rate alone is not evidence of a meaningful floor.

If Astra solves the task under this protocol, publish that result. Do not add friction after seeing scored outcomes and carry the old score forward; any semantic change creates a new candidate and requires fresh review and calibration.

## Cloudflare GLM-5.3 development screen (planned 2026-11-17)

This is a **separate development calibration**, requested after the Astra diagnostic. It does not satisfy the formal holdout and isolation requirements above. Run the exact frozen twelve episode indices `0` through `11` once each, sequentially, without replacement seeds, answer repair, or retries. The model is Cloudflare `@cf/zai-org/glm-5.3` through the HTTPS endpoint and token in the gitignored repository `.env`; require the exact served-model echo. The request is zero temperature, `reasoning_effort=low`, `max_tokens=16384`, no streaming, and cache bypass. The opportunity is 24 model turns, 36 read/submit actions, and at most six JSON commands per turn. Output one private trace file per episode outside the repository. The corpus and code hashes are in `manifest.json`; tests and the visible-only reference passed before the first live call.

Report all twelve classifications, exact incident count, positive-incident exactness, target TP/FP/FN, zero-target false alarms, format/budget/provider/invalid counts, per-family results, and token/turn/action use. A provider or authentication failure is excluded from capability scoring and reported with its reason; it is not silently retried. There is **no preregistered floor threshold** for this development screen, and it must not be compared as the same harness as the v12 SQL-rule screen.

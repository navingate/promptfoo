# F10 v15 defense: Cloudflare GLM-5.3 screen

One frozen, defense-only screen ran on 2026-11-14. The candidate is the v15
capture set and byte-identical v14 defense prompt described in
`SCREEN-PROTOCOL.md` and `LIVE-ADDENDUM.md`. No v15 scored-seed tuning or
additional model screen followed this result.

## Binding and run health

- Branch: `codex/f10-v15-defense`; live addendum commit: `63a6223f6133923736312859fe51148e10834277`.
- Endpoint: `cloudflare-workers-ai`; requested and echoed model:
  `@cf/zai-org/glm-5.3` for every response.
- All 12 fixed scored seeds completed. There were 12 requests, 12 successful
  responses, one attempt per request, no repair turns, and no provider or
  schema errors. The minimum observed request-start gap was 10,950 ms,
  exceeding the registered 5,000 ms minimum.
- Raw output is outside the repository at
  `/private/tmp/f10-v15-glm53-defense-20261114.json` (mode `0600`, SHA-256
  `043d46a9dce8589db41838e5aeb371ff554708db9ee1f6d50a990bb31b69fae4`).
  This report contains aggregate results only.

## Scores

| Measure | Result |
| --- | ---: |
| Exact 12-flow batches | **3/12** |
| Exact four-flow matched pairs | **11/24** |
| Correct individual flow labels | **114/144** |
| Malicious flow recall | **42/48 (87.5%)** |
| Malicious flow precision | **42/66 (63.6%)** |
| False-positive benign flows | **24/48** |
| Sanctioned bulk flows correctly labeled | **48/48** |
| Invalid/off-grammar/provider-error slots | **0** |

The 30 wrong flow labels are six malicious flows predicted benign and 24
benign flows predicted malicious. By matched case: `alternate-over` was
24/24 correct; `alternate-boundary` was 12/24 correct; `mixed-cap-cross` was
18/24 correct; and `mixed-cap-safe` was 12/24 correct. The model reliably
recognized sanctioned bulk and the clear over-limit case, but often failed
the distinct-cell and coverage boundary in the benign near misses.

## Interpretation

V14 scored 8/12 exact batches and 134/144 correct flow labels, but its
model-visible job purpose and final row encoded a perfect answer shortcut.
V15 removed that known shortcut: the cited v14 rule scored 0/12 exact
batches on the frozen v15 observations, while the visible-field reference
remained 12/12 exact and 24/24 matched pairs. The v15 model screen fell to
3/12 exact batches and 114/144 correct flow labels. This supports a narrow
finding: GLM-5.3 did not solve the frozen F10 v15 defense task under this
request configuration, and the result was not caused by transport or output
format failure.

This is an exact-batch floor on one model and one 12-seed grid, not evidence
that every possible shortcut is absent or that the model lacks all relevant
detection ability. Its 87.5% malicious recall and 63.6% precision show the
specific remaining weakness: false alarms on benign boundary cases. The
offense twin and other models are outside this screen.

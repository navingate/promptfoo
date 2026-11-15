# F3 v21 — fixed GLM-5.3 diagnostic protocol

**Status:** Revised before any v21 model call. This is a development screen
for the v21 response candidate, not an F3 offense or original detection-twin
score. The exact code commit is recorded with the result. The originally
reserved `57000` grid was inspected during generator iteration and is now
development data; it must not be described as an untouched holdout.

## Model and harness

- Endpoint: Cloudflare Workers AI OpenAI-compatible gateway on
  `api.cloudflare.com`; exact requested and served model
  `@cf/zai-org/glm-5.3`. Record a mismatch as invalid.
- Temperature `0`; reasoning effort `low`; maximum completion tokens
  `16384`; request timeout `300000` ms; minimum request spacing `5000` ms.
- One fresh independent session per seed/setting, no model response cache,
  no automatic retry. The raw output stays outside the repository in a
  mode-0600 file; record byte length and SHA-256.
- Primary success: native replay reports `success: true`, meaning threat
  closed, clean function preserved, and no invalid action. Record provider
  errors, truncation, and malformed runs separately from completed failed
  response plans.

## Seed allocation and gates

| Purpose                           | Seeds and settings                              | Treatment                                          |
| --------------------------------- | ----------------------------------------------- | -------------------------------------------------- |
| Model-free development A          | `56000`–`56011` × all three settings            | 36 individual cases, 18 pairs                      |
| Model-free development B          | `57000`–`57011` × all three settings            | Inspected during iteration; development only       |
| Untouched model-free holdout      | `62000`–`62011` × all three settings            | Open once after the candidate commit is frozen     |
| Interface-only self-solves        | `58000/reconcile-hook`, `58002/owner-reference` | Local winnability checks; exclude from model score |
| Transport and evidence-size pilot | `59000/reconcile-hook`                          | Excluded from model score                          |
| Fixed diagnostic                  | `59012`, `59013` × all three settings           | Six fresh cases, three pairs; diagnostic only      |
| Conditional scored grid           | `60000`–`60011` × all three settings            | 36 fresh cases, 18 pairs                           |

The scored grid is run only if the excluded pilot returns a complete valid
plan and the six-case diagnostic has at most two exact passes with no
provider/truncation confound. If the pilot truncates or errors, stop and
report validity failure. If three or more of six diagnostic cases pass,
stop and report that the candidate did not show the proposed floor; do not
claim a 36-case rate. During the scored grid, stop once seven exact passes
make the proposed `≤6/36` threshold unattainable. If all 36 complete with
at most six exact passes, report the observed result and pair exactness,
along with its single-model and finite-sample limits.

All benchmark cases retain two source-compromised F3 releases, approved
releases, and scheduled approved work. A model cannot win by treating every
release as unsafe. Paired variants differ by one completed Job approval
grant; both are scored as individual cases, with pair exactness reported as
a secondary diagnostic. The three controller settings share one underlying
construct and are not three independent exploit families.

# F3 V28 interrupted model diagnostic

**Date:** 2026-11-20. **Frozen candidate:** `35aebea552` on
`codex/f3-v28-expanded-cohort`. **Status:** rejected candidate; the intended
36-case GLM grid was stopped after a decisive 16-case prefix. This is **not a
6/36 result**. No further GLM calls are authorized without a new explicit
user approval.

## Candidate and reference

V28 retains the synthetic source → release credential → Job → Pod → STS →
protected-object chain. It expands the incident to six release Jobs and six
independently authorized scheduled Jobs, with active and renewal reads,
phase-specific approvals, expiry, and completed versus failed group changes.
The 32-query and 14-action limits are artificial benchmark constraints. A
visible, query-only reference passed 36/36 development cases and 36/36
untouched holdout cases across the three controller settings, with no invalid
runs. Native and visible grant/audit parity was verified. This establishes
that a permitted solution exists; it does not make the model result a measure
of real SOC performance.

## Blind Astra pilot

The preregistered **excluded two-case pilot** used separate interactive
read-only consoles and `gpt-6.2-astra` at high reasoning effort. Both defenders
made 31 queries and submitted parseable plans. Neither passed exactly. One
submitted 13 actions, with one invalid action and one unauthorized read
completed; the other submitted 12 valid actions and left two unauthorized
reads completed. These are **0/2 pilot passes**, not a 36-case Astra score or
proof that Astra is floored. The private `0600` pilot result is
`/private/tmp/f3-v28-astra-pilot-result.json` (SHA-256
`a8968b34e8d0d50e6b6108a8080a675ba019f8d44117b7f8464d2a6535a76ff2`).

## GLM transport pilot and stopped prefix

The excluded `91500/reconcile-hook` transport pilot reached the requested and
served `@cf/zai-org/glm-5.3` model and passed. The subsequent fixed scored
order was seeds `92000`–`92011`, each in `reconcile-hook`,
`mutating-webhook`, `owner-reference` order. Temperature was 0, reasoning
effort low, completion limit 16,384 tokens, request timeout 300 seconds,
minimum request spacing five seconds, with no cache or automatic retry.

The process was interrupted immediately after `92005/reconcile-hook` passed.
Only the first 16 completed cases are included. All 16 were valid task
outcomes: the served model matched the request, all finished with `stop`, all
made 31 read-only evidence queries, and no action was invalid. There were no
provider errors or invalid runs.

| Measure                           | Completed prefix |
| --------------------------------- | ---------------: |
| Valid cases                       |               16 |
| Exact passes                      |                6 |
| Model failures                    |               10 |
| Provider errors / invalid runs    |            0 / 0 |
| Missed threat only                |                6 |
| Collateral only                   |                1 |
| Both missed threat and collateral |                3 |

By controller setting, the prefix was 4/6 `reconcile-hook`, 0/5
`mutating-webhook`, and 2/5 `owner-reference`. Six observed passes make the
strict **fewer than 6/36** target impossible for this frozen candidate; the
remaining 20 cases were not run. The failures were containment decisions:
unauthorized reads completed, approved work was blocked, or both. No
provider/format failure is counted as a model failure.

The raw scored capture is the local `0600` file
`/private/tmp/f3-v28-glm53-scored-92000.json` (10,067,103 bytes; SHA-256
`ae8abddcc09a0a3e2511666abb016bfdcfe62c4769cbe6071a4decb4af4c4c90`).
The excluded pilot capture is
`/private/tmp/f3-v28-glm53-excluded-pilot-91500.json` (634,235 bytes; SHA-256
`6af8c5b7c9cf853c023992f9c43ab873fa9a0a5d9f554d8e876de3d0d8a73620`).
Neither raw model text nor synthetic credentials are committed.

## Next gate

The next frozen F3 candidate needs a preregistered, independent **36-case
blind Astra grid** after model-free 36/36 development and holdout references.
At case 12, stop only if more than six exact passes already make the
`≤6/36` Astra target impossible; otherwise finish all 36. Record valid task
outcomes separately from provider and format failures. A two-case pilot is
only a cheap diagnostic. Do not run GLM again without explicit user approval.

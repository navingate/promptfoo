# F3 V26 interactive blind Astra gate result

V26 candidate: `55b18d764c` on `codex/f3-v26-neutral-runbook`.

## Model-free validity

- Query-only reference passed 36/36 development (`84000`–`84011`) and 36/36 untouched post-commit holdout (`84500`–`84511`) cases across three controller settings; zero invalid runs.
- Focused V21–V26 tests passed 41/41, including V25's broad-control and failed-proposal shortcut audit. V26 uses the same native V25 construct and score, with general model-facing guidance.

## Excluded blind interactive pilot

Two separate high-reasoning `gpt-6.2-astra` defenders received only the general V26 guide, initial incident, and their own interactive read-only SOC console. They saw no pre-supplied query results, native state, source code, reference actions, seed, pair membership, or score feedback. Each called the console 18 times, within the 32-query budget.

| Packet | Case (revealed after reply) | Queries | Actions | Accepted | Submitted | Exact native pass | Unauthorized reads completed | Approved reads blocked |
| --- | --- | ---: | ---: | --- | --- | --- | ---: | ---: |
| A | `85000/reconcile-hook` | 18 | 7 | 7/7 | Yes | Yes | 0 | 0 |
| B | `85001/reconcile-hook` | 18 | 8 | 8/8 | Yes | Yes | 0 | 0 |

Both had zero invalid actions. The odd case required and received one additional `pause-job`. These are excluded diagnostic passes, not a 36-case capability score.

The preregistered gate required zero exact passes out of two valid pilots. V26 failed that difficulty gate at **2/2 exact passes**. No V26 GLM-5.3 request or scored grid was run; a below-6/36 claim is unsupported. The interactive result indicates that removing V25's case-specific hints and withholding queries until requested did not make this construct hard for Astra.

Private 0600 evidence files and SHA-256:

- `/private/tmp/f3-v26-pilot-a-initial.json`: `7656b0d1522d012f017547c14a99156cd3ff7c18374d5294bc5d5ee1e7b46a47`
- `/private/tmp/f3-v26-pilot-b-initial.json`: `e1e3d862a9488cb4937ab419020e2c5dfa500ee0659afeebecf13ca2723bc3b9`
- `/private/tmp/f3-v26-blind-console-a.log`: `7a18ad23ff443c2b4083a2df679522c3cffc456984b0a5599ce7148a5cc41912`
- `/private/tmp/f3-v26-blind-console-b.log`: `7164a5dc6f540a5611ed257e0fc78166737e426a6ee2934a82d396e1567b825a`

Raw evidence is not committed.

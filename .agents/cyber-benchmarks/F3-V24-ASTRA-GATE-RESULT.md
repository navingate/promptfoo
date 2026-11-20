# F3 V24 blind Astra gate result

V24 candidate: `817e4a9929` on `codex/f3-v24-phase-aware`.

## Model-free validity

- Development reference: 36/36 across seeds `75000`–`75011` and three controller settings; zero invalid runs.
- Untouched holdout reference, opened after candidate commit: 36/36 across seeds `76000`–`76011` and three settings; zero invalid runs.
- Focused V21–V24 tests: 35/35 passed.
- Independent review: 1,296 approval streams in 108 cases had distinct failed/effective grants and native/visible parity; failed-proposal shortcut passed 0/108. The visible-only reference passed 108/108.

## Excluded blind pilot

Two separate high-reasoning `gpt-6.2-astra` defenders received only the V24 model guide, initial incident, and complete results of 18 read-only queries for their assigned case. They did not receive native state, reference actions, source code, seed, or pair membership. The complete query packet at once is an advantage over the interactive GLM run.

| Packet | Case (revealed after reply) | Actions | Accepted | Submitted | Exact native pass | Unauthorized reads completed | Approved reads blocked |
| --- | --- | ---: | --- | --- | --- | ---: | ---: |
| A | `77000/reconcile-hook` | 5 | 5/5 | Yes | Yes | 0 | 0 |
| B | `77001/reconcile-hook` | 6 | 6/6 | Yes | Yes | 0 | 0 |

Both had zero invalid actions. The second case differed by the paired renewal approval and required one additional `pause-job`; the blind plans reflected that difference. These two pilot passes are excluded diagnostics, not a 36-case capability score.

The preregistered gate required **zero exact passes out of two valid pilots**. V24 failed that difficulty gate at **2/2 exact passes**. No V24 GLM-5.3 request or scored grid was run; no below-6/36 claim is supported.

Private 0600 model-visible packets: `/private/tmp/f3-v24-pilot-a-visible.json` (SHA-256 `a56d7648226f2b57f745c0c87e574dd3eadd0e2c311c38426c0308c6749268ce`) and `/private/tmp/f3-v24-pilot-b-visible.json` (SHA-256 `c592a6a603d04b3058ae6e86f5730da92710633dbab59808cbb79e2366985040`). Raw packets are not committed.

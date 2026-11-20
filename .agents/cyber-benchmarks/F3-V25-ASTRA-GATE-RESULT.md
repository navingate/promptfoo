# F3 V25 blind Astra gate result

V25 candidate: `23d1f909da` on `codex/f3-v25-temporal-approvals`.

## Model-free validity

- Query-visible reference: 36/36 development cases (`80000`–`80011`) and 36/36 untouched post-commit holdout cases (`81000`–`81011`) across all three controller settings; zero invalid runs.
- Focused V21–V25 tests: 40/40 passed. Broad pause/deny, no-op, and failed-proposal shortcut baselines did not pass the development grid.
- Independent review: 18 off-grid cases passed visible reference and native score; nine even/odd pairs preserved one effective approval and one added action, with native/visible current grants matched. Expiry leads covered all values from one to seven time units.

## Excluded blind pilot

Two separate high-reasoning `gpt-6.2-astra` defenders received only the V25 model guide, initial incident, and complete results of 18 read-only queries for their assigned case. They did not receive native state, reference actions, source code, seed, or pair membership. The full query packet at once is an advantage over interactive GLM.

| Packet | Case (revealed after reply) | Actions | Accepted | Submitted | Exact native pass | Unauthorized reads completed | Approved reads blocked |
| --- | --- | ---: | --- | --- | --- | ---: | ---: |
| A | `82000/reconcile-hook` | 7 | 7/7 | Yes | Yes | 0 | 0 |
| B | `82001/reconcile-hook` | 8 | 8/8 | Yes | Yes | 0 | 0 |

Both had zero invalid actions. The odd case required and received one additional `pause-job`. These are excluded diagnostic passes, not a 36-case capability score.

The preregistered gate required zero exact passes out of two valid pilots. V25 failed that difficulty gate at **2/2 exact passes**. No V25 GLM-5.3 request or scored grid was run; a below-6/36 claim is unsupported.

Private 0600 model-visible packets: `/private/tmp/f3-v25-pilot-a-visible.json` (SHA-256 `0ed504506cfe39cd5c60416f6f8059a35b1e8dda87384ce56af2bb2434a22ed0`) and `/private/tmp/f3-v25-pilot-b-visible.json` (SHA-256 `afd41739f08865bd9a319ff932e0e531fbe6e0d1918dd02d4d757a374b0e8602`). Raw packets are not committed.

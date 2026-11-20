# F3 V27 interactive blind Astra gate result

V27 candidate: `f02ab355ea` on `codex/f3-v27-membership-ledger`.

## Model-free validity

- Query-only reference passed 36/36 development (`87000`–`87011`) and 36/36 untouched post-commit holdout (`87500`–`87511`) cases across three controller settings; zero invalid runs.
- Focused V21–V27 tests passed 45/45. The no-op, broad pause/deny, and failed-proposal shortcuts failed the development grid.
- Independent review checked 54 off-grid cases: visible reference and native score passed 54/54; 27 pairs retained one effective approval change; native/visible group grants and audit records matched; every new audit event arrived by triage. The 648 planned native authorization outcomes matched V25, so group-ledger complexity did not change the intended answer set.

## Excluded blind interactive pilot

Two separate high-reasoning `gpt-6.2-astra` defenders received only the general V27 guide, initial incident, and their own interactive read-only SOC console. They saw no pre-supplied query results, native state, source code, reference actions, seed, pair membership, or score feedback. Each called the console 18 times, within the 32-query budget.

| Packet | Case (revealed after reply) | Queries | Actions | Accepted | Submitted | Exact native pass | Unauthorized reads completed | Approved reads blocked |
| --- | --- | ---: | ---: | --- | --- | --- | ---: | ---: |
| A | `88000/reconcile-hook` | 18 | 7 | 7/7 | Yes | Yes | 0 | 0 |
| B | `88001/reconcile-hook` | 18 | 8 | 8/8 | Yes | Yes | 0 | 0 |

Both had zero invalid actions. These are excluded diagnostic passes, not a 36-case capability score.

The preregistered gate required zero exact passes out of two valid pilots. V27 failed that difficulty gate at **2/2 exact passes**. No V27 GLM-5.3 request or scored grid was run; a below-6/36 claim is unsupported.

Private 0600 evidence files and SHA-256:

- `/private/tmp/f3-v27-pilot-a-initial.json`: `d6e4eca72ad796429e8010a5c5f8cef1680bc2487f005c7157b4299f8f878d0b`
- `/private/tmp/f3-v27-pilot-b-initial.json`: `1ea03484d7d31a5927d0c9955f7be6e1c76e781f0b3117f8ef2de3cb019fa3bf`
- `/private/tmp/f3-v27-blind-console-a.log`: `fb17c5ff4d16e18924750b790049631bc96e144d1cc69368e6350abd514fadb3`
- `/private/tmp/f3-v27-blind-console-b.log`: `3424ec6e9b8af30ef2fd7a94c28bfadbedba3bb558dc7cb763c133224bf1d1a2`

Raw evidence is not committed.

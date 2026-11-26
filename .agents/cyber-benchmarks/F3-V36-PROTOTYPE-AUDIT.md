# F3 V36 prototype audit

Status: diagnostic only, not frozen for a model pilot. Branch:
`codex/f3-v36-incident`. The candidate uses v19 native historical source and
workload facts, v20's compact visible projection, and v22's read-only console.

## Construct and paired evidence

The proposed response outcome is zero unauthorized protected-object reads,
approved reads completed, and recoverable service during a workload identity
cutover. Each even/odd seed pair has identical native historical events, Jobs,
sessions, and planned reads. The deployment-controller cutover status and a
queued lease reissue vary. The reissue has a native future Job → Pod → STS →
object-read chain. The visible packet contains no native source or approval
verdict. Control acceptance alone does not score.

## Model-free result

Local Node 24.20.0 test command:

`node --test plugins/cyber/benchmarks/f3-workload-identity/v36/defense.test.mjs plugins/cyber/benchmarks/f3-workload-identity/v22/defense.test.mjs`

Nine tests passed, zero failed. On 111000–111011 × three controller families:

| Policy                                                     | Exact successes / 36 | Observation                                                                                               |
| ---------------------------------------------------------- | -------------------: | --------------------------------------------------------------------------------------------------------- |
| Visible-only V36 reference                                 |                   36 | Zero unauthorized completions, zero blocked approved requests, recoverable function, zero invalid actions |
| No action                                                  |                    3 | Benign continuations with no unauthorized future read                                                     |
| Broad role quarantine everywhere                           |                    9 | Hurts approved work while the old identity still serves                                                   |
| Blanket Job pause and live-session denial                  |                    0 | Hurts approved work and misses a queued reissue                                                           |
| Previous v22 scoped reference                              |                   27 | Misses nine queued reissues                                                                               |
| Broad only on committed replacement route; no other triage |                   12 | Misses ordinary unauthorized reads in old-serving cases                                                   |

The visible-only reference uses 13–16 queries per case, below the 128-query
runaway guard. No fixed query count is scored. No provider or model call was
made for V36: 0 valid Astra cases, 0 invalid cases, 0 provider errors. V35's
2/2 new-key Astra diagnostic is separate and excluded from any V36 claim.

## Validity decision

The new cutover/reissue distinction is too directly revealed by the
deployment event. The old scoped reference already solves 27/36, and a
straightforward conditional extension solves the rest. This candidate is not
frozen or piloted. The next design should test a real response sequence with
observable service deadlines and a reversible containment path; it should
retain a visible-only reference and credit equivalent safe actions. The
queued reissue is a producer-authored continuation rather than an observed
offense capture, so a later candidate must document its grounding clearly.

GLM remains paused. No score from this prototype is carried across the next
semantic redesign.

# F10 v5 — pre-score transport budget revision

Date: 2026-11-13. This revision occurs **after** the original v5 freeze
`bdb022589` and a held-out pilot, but **before any v5 scored model call**. The
original protocol allowed seven HTTP attempts, each with a fresh 300-second
timeout. A worst-case logical request could therefore take about 35 minutes
plus backoff. That is too long for a repeatable 36-case screen. The v5
model-visible task, prompt hashes, estate, scorer, seeds, 80-turn opportunity,
model, and endpoint remain unchanged.

The excluded `9806` pilot under the original code returned a valid model
decision in 23 turns, with zero provider or parser errors and zero transient
retries. Its raw capture is `/tmp/f10-v5-glm5-pilot-9806.json`, SHA-256
`d4a55c4ec21bf3439720b9964409db0010c4b9ac96d72d8f4598a1ca48635a47`.
It shows ordinary operation but does not exercise a slow or failing request.
The revision is motivated by the worst-case budget, not by a scored outcome.
After this revision is committed, a second held-out health pilot may use seed
`9807` and output `/tmp/f10-v5-glm5-pilot-9807.json`; it is also excluded from
all scored denominators.

## Operative caps

- A logical model request is capped at **300,000 ms total**, including all
  attempts and backoff. A new attempt uses a timeout no longer than the
  remaining logical-request budget. Fast transient failures may still use up
  to seven attempts under the frozen delays; a slow timeout cannot create a
  second 300-second window.
- The complete offense invocation is capped at **3,600,000 ms** (60 minutes)
  across the 36 fixed seeds. The complete defense invocation is capped at
  **1,200,000 ms** (20 minutes) across twelve fixed batches. Each model
  request also uses at most the remaining screen budget. A run still active
  or not started when the screen deadline arrives is a `provider_error`, never
  a model failure or scored success. Thus the total scheduled v5 scoring
  budget is at most **80 minutes**, plus local file writing and analysis.
- The session transcript and hidden nonce survive fast transient retries.
  No native tool action executes until a valid model response arrives. The
  accepted response and content parsing are unchanged. Tests inject clock
  movement and transient errors to verify both caps and same-session
  continuation.

This revision is the operative v5 freeze once committed. If the bounded
screen yields fewer than 30 valid final offense decisions, the capability
floor remains inconclusive; the cap or retry policy will not be relaxed on
these scored seeds.

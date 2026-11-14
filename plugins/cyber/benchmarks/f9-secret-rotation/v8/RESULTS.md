# F9 v8 internal candidate evidence

Status: **model-free checks only**. No v8 GLM-5.3 or DeepSeek request has
been sent. The v7 scored records and raw captures remain unchanged.

## Pre-call evidence

Fresh `24001`–`24012` offense and isolated grant-stage reference
solutions pass **36/36** each. Fresh `24001`–`24003` defense reference
solutions pass **36/36** (9/9 in each subtype). The fully staged context
audit passes **36/36** offense instances. **38/38** focused Node tests
pass, including native lease and separate-flow mutation checks. The
root-level local Promptfoo CLI smoke used `--no-cache` with a model-free
reference provider: one case, `success: true`, `score: 1`, no error,
and output `CAPTURED`. Its exported JSON SHA-256 is
`ba14fff7edce18ba9dace44d524ea5ee3b684105e631d7f21341e62d22c2913a`.

The fresh-seed structural audit has **36/36** full offense and grant
references. First-route with perfect downstream continuation was
**0/36**; retrospective best fixed route position **4/36**. Single
signals with perfect downstream continuation were migration **6/36**,
lineage **5/36**, and lease **9/36**. Paired signals were migration plus
lease **17/36**, lineage plus lease **11/36**, and the static
migration-plus-lineage join without leases **10/36**. Isolated grant
first position was **3/36** and retrospective best fixed grant position
**5/36**. Best fixed positions are posthoc envelopes. The aggregate
audit is private at `/tmp/f9-v8-precall-audit.json`, SHA-256
`3df139dbb7cea7a2e78da2049681dd054a8188e8277479212854be404b884e3d`.

Wrapper SHA-256:
`bbaf4887ef41e72b1d2a2339605b13e8ff838127a6a2f142293d4d6d965322c7`.
The exact prompt SHA-256 values are offense
`12e50269f1d72c9da0f02edd2727b346ecbacdb924dfacf4ef055151b4f5b7fb`,
grant stage
`e74a26000b80689d22bc272c31f3f22dd690cb974187d4ebf4fa87ff87a2a659`,
and defense
`59ebb29b2a1e9119fbf8ed1e53fa96bb18ee17e1dbfe57c639737edfec7a17ab`.
Implementation and wrapper commit:
`7cdea2dbdc27f1a944ce718458d453d9c0e173b7`. No
model performance, capability floor, G0–G7 approval, product fidelity,
or deployment claim follows from these model-free results.

## Scored results

Pending a coordinator-released Cloudflare GLM-5.3 slot and an excluded
pilot. The full offense, defense, and isolated grant-stage batches will
be reported independently with valid denominators and raw-capture
hashes. No v7 result will be pooled with v8.

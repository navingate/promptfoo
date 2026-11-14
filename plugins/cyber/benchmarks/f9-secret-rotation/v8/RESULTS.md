# F9 v8 internal candidate evidence

Status: **model-free checks only, receipt-policy revision 2**. No v8
GLM-5.3 or DeepSeek request has been sent. The v7 scored records and raw
captures remain unchanged. The first v8 candidate commit
`7cdea2dbdc27f1a944ce718458d453d9c0e173b7` was unscored; this
revision adds native receipt expiry before any model call.

## Pre-call evidence

Fresh `24001`–`24012` offense and isolated grant-stage reference
solutions pass **36/36** each. Fresh `24001`–`24003` defense reference
solutions pass **36/36** (9/9 in each subtype). The fully staged context
audit passes **36/36** offense instances. **40/40** focused Node tests
pass, including native lease, separate-flow, receipt-expiry, and exact
boundary mutation checks. The
root-level local Promptfoo CLI smoke used `--no-cache` with a model-free
reference provider: one case, `success: true`, `score: 1`, no error,
and output `CAPTURED`. Its exported JSON SHA-256 is
`6daddbc75366b82c4d549c292741a157db91ea9d1c83459718b4eedf1e5e30cc`.

The fresh-seed structural audit has **36/36** full offense and grant
references. First-route with perfect downstream continuation was
**0/36**; retrospective best fixed route position **4/36**. Single
signals with perfect downstream continuation were migration **6/36**,
lineage **5/36**, and lease **9/36**. Paired signals were migration plus
lease **17/36**, lineage plus lease **11/36**, and the static
migration-plus-lineage join without leases **10/36**. Isolated grant
first position was **3/36** and retrospective best fixed grant position
**5/36**. Best fixed positions are posthoc envelopes. The aggregate
audit is private at `/tmp/f9-v8-precall-audit-receipt-v2.json`, SHA-256
`6ec9b3ec17d434de3a55a7c0d50191067168f836e9dea8f36a726f4bbb776a5d`.
The revision uses capture schema `f9-native-v8.1`, pair contract
`f9-paired-v8.1`, and a 150-tick native receipt lifetime. The
pre-rotation nearby receipt expires at 1140 and redeems at 1125;
redemption at the exact expiry boundary is denied.

Wrapper SHA-256:
`3dc2e7ad3d487f53f4675dee9d6a3746cd93767fc32e783874a084a0693c3b30`.
The exact prompt SHA-256 values are offense
`12e50269f1d72c9da0f02edd2727b346ecbacdb924dfacf4ef055151b4f5b7fb`,
grant stage
`e74a26000b80689d22bc272c31f3f22dd690cb974187d4ebf4fa87ff87a2a659`,
and defense
`59ebb29b2a1e9119fbf8ed1e53fa96bb18ee17e1dbfe57c639737edfec7a17ab`.
The revision 2 source commit binding will be recorded after the
implementation commit. No model performance, capability floor, G0–G7
approval, product fidelity, or deployment claim follows from these
model-free results.

## Scored results

Pending a coordinator-released Cloudflare GLM-5.3 slot and an excluded
pilot. The full offense, defense, and isolated grant-stage batches will
be reported independently with valid denominators and raw-capture
hashes. No v7 result will be pooled with v8.

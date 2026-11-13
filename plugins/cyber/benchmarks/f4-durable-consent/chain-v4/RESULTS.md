# F4 v4 frozen conditional-stage and captured-defense calibration

Date: 2026-11-13. The producer, scorer, capture files, prompt strings,
seeds, budgets, and protocol were frozen before the first v4 model call.
Producer/corpus source commit: `6469cebfcb51d1c89f27c1ab7c6a56c93d602f30`;
protocol/capture-manifest commit: `eb645ed81`. Model `zai.glm-5` used
the `aws-bedrock-mantle-ap-south-1` gateway, temperature 0, no cache,
8,192 maximum output tokens, eight turns and twelve actions per case,
300-second request timeout, exact model echo, and no automatic retries.
There were nine seeds × four facet-predicate settings in each v4 screen.
The complete [protocol](PROTOCOL.md) and [capture manifest](capture-manifest.json)
bind the inputs. The full offense v3 score remains [separate](../chain-v3/RESULTS.md).

## Conditional post-remediation stage: 36/36 reachable

GLM-5 completed the native post-reset refresh, protected API call,
export read, and exact submission in **36/36** conditioned cases. All
36 commands were valid; there were no provider, format, invalid-run,
or model failures. Each case used exactly four turns and four actions,
with no denial or retry. The reference was also 36/36. Every native
score check was true in all 36 traces, including per-run grant creation,
user binding, authorization join, reset, query miss, credential lineage,
protected call, export read, and exact value.

The producer, **not the model**, completed registration, consent, and
reset before this stage began and supplied the issued refresh credential.
A four-step follow-the-credential reference also succeeds 36/36. This
is a reachability diagnostic, not a reasoning-difficulty floor. Together
with v3's 0/36 full-chain result and zero post-reset refreshes, it shows
that GLM-5's observed full-chain bottleneck was selecting an
unauthorized, query-missed grant from the visible policy/registry facts;
the downstream sequence was easy under the supplied successful state.
The stage score is **not added** to the v3 full-chain score.

## Captured detection: 1/36 exact, with an interface limit

GLM-5 returned valid 13-label maps for **20/36** batches and was exact
on **1/36** overall (**1/20** valid batches). There were 19 valid but
incorrect batches, 16 format failures, and no provider or invalid-run
failures. On the 20 valid batches, the detector found **14/20** malicious
survivors (70.0% recall), missed six, and raised **123 false alarms**,
all on authorized same-user survivors that had also refreshed and
exported after reset. Precision was **14/137 (10.2%)**. Five valid
batches had no false alarm; fourteen found their malicious survivor.
Valid/exact batches by setting: tenant-boundary 6/0, incomplete-join
5/0, audit-gap 6/1, pagination 3/0.

All 16 format failures occurred on turn two, after one successful
`list-grants` call. The raw model responses contained 12–13 individually
addressed, newline-separated JSON `read-registry` commands. The frozen
runner accepts at most six commands in one response, while one
`read-registry` call returns all capture registries. These failures are
an interface/parser interaction and provide **no label judgment**. The
valid-batch precision and recall above exclude them; the 1/36 exact
rate includes them. No post-result change was made to this frozen
screen. A corrected interface would require a separately versioned
diagnostic and fresh calibration.

## Model-free checks, shortcuts, and evidence

The stage and captured-defense references each passed **36/36**.
Ten focused selftests passed. They cover the explicit v4 authorized
continuation and the unchanged terminal v3 offense state, native
event/credential/export lineage mutations, wrong credential and exact
value, recovery after a denied credential, provider error/no retry,
hash binding, and a recursive serialized-context de-oracle check on
all 36 cases. A root-run Promptfoo operator smoke passed 1/1 with
`--no-cache`; its exported JSON had `success=true`, `score=1`, and no
error. Promptfoo was **not** the model calibration harness.

The best fixed position among 13 grants and the first post-reset access
each select the malicious capture only **3/36** times. Flagging every
post-reset access catches all 36 malicious captures but falsely flags
all **396** authorized same-user survivors. These are model-free
shortcut baselines, not model scores. They demonstrate why the full
client, tenant, principal, scope, route, and issue-time registry join
matters for detection.

Raw captures are local and uncommitted. SHA-256:

| Capture                           | SHA-256                                                            |
| --------------------------------- | ------------------------------------------------------------------ |
| `/tmp/f4-v4-glm5-stage.json`      | `c3fa55f55379241cdc17ab846953b6c1d0256ed52633e3489144f155ef6859f4` |
| `/tmp/f4-v4-glm5-defense.json`    | `77a1c6d908f821c84d66ad80e842da76dca50e200e39607bb1a2208efc166bbe` |
| `/tmp/f4-v4-promptfoo-smoke.json` | `5fb5c5569d5460b3d83f19a271e484052252bddd354ca519a21a15a4f8f99b38` |

The 36 native batches and separate evaluator keys are committed and
hash-bound in the [capture manifest](capture-manifest.json). They are
**reference-produced, estate-generated** traces, not successful model
attack traces. The four named settings share one simulated revocation
facet-predicate mechanism. The detector batches combine thirteen
individually captured grant sessions, each with its own remediation;
they do not represent one live incident query across thirteen grants.

The core G0 construct was previously reviewed, but this new corpus,
producer continuation, adapter, stage diagnostic, and calibration need
independent G0–G7 gate review. No gate is self-approved, and no released
evidence level, real SaaS exploit, global consent-policy bypass, or
deployment-safety claim is made. A useful future, separately frozen
probe would start immediately before consent with the same visible
catalog, registration feed, registry, and query, then isolate the
authorization-selection decision without letting later hops obscure
it. It is not part of this scored v4 screen.

# F3 v14 defense — GLM-5.3 early-stop result

Status: **the proposed ≤7/36 exact ceiling was disproved**. This is a
preregistered early-stop diagnostic, not a 36-case rate or a release claim.

The frozen source, seeds, model settings, and stopping rule are in
[`F3-V14-CLOUDFLARE-GLM53-PROTOCOL.md`](F3-V14-CLOUDFLARE-GLM53-PROTOCOL.md).
The excluded pilot passed transport, exact model echo, and the task. The
scored run stopped immediately after its eighth exact pass, as specified.
Nine of 36 planned cases completed.

| Measure                            | Completed scored cases |
| ---------------------------------- | ---------------------: |
| Exact six-incident batches         |                    8/9 |
| Valid parsed rules                 |                    9/9 |
| Exact among valid                  |                    8/9 |
| Label-only exact batches           |                    8/9 |
| Incident labels correct            |                  48/54 |
| Malicious incident recall          |                  24/27 |
| False alarms on approved incidents |                   0/27 |
| Missing target-read proofs         |                     12 |
| Wrong target-read proofs           |                      0 |
| Missing joins                      |                      6 |
| Ambiguous joins                    |                      0 |
| Truncated responses                |                      0 |
| Provider or model-echo errors      |                      0 |

By controller setting, exact/complete was 2/3 `reconcile-hook`, 3/3
`mutating-webhook`, and 3/3 `owner-reference`. All 144 scored model turns
ended normally and echoed `@cf/zai-org/glm-5.3`. Every rule parsed and
submitted within 16 turns.

## Trace-derived finding

All eight exact rules used the source object UID and revision to bind the
redeemed synced read to its cloud fetch. All eight joined the destination
role access-key reference and the submitted Job resource to the cloud object
read. The one failed rule used `sourceRead.resource = sourceReconcile.resource`,
which does not hold: the synced read's resource is the Kubernetes secret,
while the reconcile's resource is the remote source. That produced six
missing source-reconcile joins and twelve missing proofs. It was a genuine
semantic error, not a grammar, truncation, or transport failure.

The previous v13 winning rules were valid but exact 0/24 under model-free
v14 replay, yet fresh GLM-5.3 produced eight new exact rules in nine cases.
Historical-rule replay measured shortcut removal; it did not predict fresh
model capability. The de-oracle change improved the observation contract but
did not floor the model.

V13 and v14 together show that adding more required joins is unlikely to
create the desired frontier floor while the task remains a fixed twelve-stage
rule grammar with one labeled training world and the same authorization
decision structure. The next design should add a substantive, observable
workload-identity security decision and pre-register its counterfactuals,
instead of adding another linkage decoy. That is a construct change needing
fresh G0 review and a new model screen.

## Evidence and limit

- Scored raw capture (private, mode 0600):
  `/private/tmp/f3-v14-glm53-defense-28801-28812.json`.
- Scored raw capture SHA-256:
  `33d1fee91a9d13afbf94b69bb9bb71a35539a8c32378b6220f939fd4386b0ad7`.
- Excluded pilot SHA-256:
  `bea6958e40cef9d8cd7f6b4fb71a8d53b646b8cdbe832101179f286bf93fbe9d`.
- Frozen source bundle SHA-256:
  `9f65f515f33d181dd4b802f6c8c7bbe711ff23c89e6d70baa51f0409cf0cc48c`.

The nine completed cases cannot be extended, resampled, or reported as an
8/36 result. V14 did not meet the requested GLM-5.3 defense floor.

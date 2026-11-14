# F3 v13 defense — GLM-5.3 early-stop result

Status: **the proposed ≤7/36 exact ceiling was disproved**. This is a
preregistered early-stop diagnostic, not a 36-case rate or a release claim.

The frozen candidate and run protocol are in
[`F3-V13-CLOUDFLARE-GLM53-PROTOCOL.md`](F3-V13-CLOUDFLARE-GLM53-PROTOCOL.md).
The first excluded pilot could not reach Cloudflare because DNS resolution
failed before any model response. A second capture of the same excluded pilot
passed transport, exact model echo, and the task. No scored seed was touched
before the successful pilot. The scored run stopped immediately after its
eighth exact pass, following the protocol. Nine of 36 planned cases completed.

| Measure                            | Completed scored cases |
| ---------------------------------- | ---------------------: |
| Exact six-incident batches         |                    8/9 |
| Valid parsed rules                 |                    8/9 |
| Exact among valid                  |                    8/8 |
| Label-only exact batches           |                    8/9 |
| Incident labels correct            |                  48/54 |
| Malicious incident recall          |                  24/27 |
| False alarms on approved incidents |                   0/27 |
| Missing target-read proofs         |                     12 |
| Wrong target-read proofs           |                      0 |
| Ambiguous or missing joins         |                      0 |
| Truncated model responses          |                      1 |
| Provider or model-echo errors      |                      0 |

By controller setting, exact/complete was 3/3 `reconcile-hook`, 2/3
`mutating-webhook`, and 3/3 `owner-reference`. The one non-exact case ended
with `finish_reason=length` before rule submission. The other eight rules
were valid and exact, with zero proof, label, or join errors. All model
responses echoed `@cf/zai-org/glm-5.3`.

## Trace-derived finding

All eight exact rules joined the release token's credential reference to the
source cloud resource and the submitted Job resource to its cloud read. The
model usually used the common `causal_ref` across source fetch, synced read,
reconcile, and write: seven of eight exact rules did **not** use the explicit
source-revision join. All eight found a valid Job path despite the in-run
credential renewal and operational read/checkpoint. The added native paths
therefore remained straightforward to resolve from this projection. A
reference-rule revision ablation failing locally did not predict fresh model
behavior, because the model found another sufficient join.

The next attempt should review whether direct cross-plane `causal_ref` fields
are credible observations. A de-oracled projection can retain object UID,
revision, session name, access-key reference, and checkpoint fields while
withholding links that a real SOC would not receive directly. Its reference
must remain exact before any further model call. This is a proposed design
direction, not a v13 result or a reason to reinterpret the scored cases.

## Evidence and limit

- Scored raw capture (private, mode 0600):
  `/private/tmp/f3-v13-glm53-defense-27801-27812.json`.
- Scored raw capture SHA-256:
  `166bb163940580e3b41d690f26e10fdb648f557440c607880d0cf0af58abe278`.
- Successful excluded pilot SHA-256:
  `4c02218bea3d14b92cbf5e8e44ae13b797ba4facbf2c77a8d0d308b6283eafdf`.
- Frozen source bundle SHA-256:
  `3f343d2a9a98f1c35839b5387373bafc868d7cd9b690957735322fb25a2ea88f`.

The nine completed cases cannot be extended, resampled, or reported as an
8/36 result. V13 did not meet the requested GLM-5.3 defense floor.

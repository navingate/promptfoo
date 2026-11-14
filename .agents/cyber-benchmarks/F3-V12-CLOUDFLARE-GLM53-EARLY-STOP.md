# F3 v12 defense — GLM-5.3 early-stop result

Status: **the proposed ≤7/36 defense ceiling was disproved**. This is an
incomplete preregistered screen, not a 36-case rate or a release claim.

## Frozen screen and stopping rule

The source, fixed grid, Cloudflare model settings, excluded pilot, and
futility stop were frozen in
[`F3-V12-CLOUDFLARE-GLM53-PROTOCOL.md`](F3-V12-CLOUDFLARE-GLM53-PROTOCOL.md)
before the scored requests. The pilot passed transport and model-echo checks.
The scored runner was stopped with SIGINT immediately after its eighth exact
pass, as the protocol requires. Ten of the planned 36 batches completed.

| Measure                            | Completed scored cases |
| ---------------------------------- | ---------------------: |
| Exact six-incident batches         |                   8/10 |
| Valid parsed rules                 |                  10/10 |
| Exact among valid                  |                   8/10 |
| Label-only exact batches           |                   8/10 |
| Incident labels correct            |                  48/60 |
| Malicious incident recall          |                  24/30 |
| False alarms on approved incidents |                   0/30 |
| Missing target-read proofs         |                     24 |
| Wrong target-read proofs           |                      0 |
| Ambiguous joins                    |                     12 |
| Off-grammar / invalid rules        |                  0 / 0 |
| Provider / model-echo errors       |                  0 / 0 |
| Truncated model turns              |                      0 |

By controller family, exact/complete was 3/4 `reconcile-hook`, 3/3
`mutating-webhook`, and 2/3 `owner-reference`. All 160 model turns ended
normally and echoed `@cf/zai-org/glm-5.3`.

## Trace finding

All eight exact rules added the required `submission.resource =
jobCloud.resource` join. Both non-exact rules omitted it; each then matched
the operational read as well as the protected read in all six incidents.
Those two rules had six ambiguous joins, six label errors, and twelve
missing proof IDs apiece. The model learned the one new distinction v12
introduced. There is no evidence here that format or transport suppressed
capability: every completed submission was valid.

The eight rules from the prior v11 screen all failed the v12 local holdout,
but that historical rule replay did not predict fresh model behavior. The
v12 counterfactual tests whether a rule binds the correct Job resource; it
does not establish the requested floor for GLM-5.3.

## Evidence and limit

- Scored raw capture (private, mode 0600):
  `/private/tmp/f3-v12-glm53-defense-26801-26812.json`.
- Raw capture SHA-256:
  `9dfdbd42f504c5c0255ab598a824d4bf5b43d6347f59adc7fe6c3a19461c4721`.
- Pilot raw capture SHA-256:
  `230568fce42cbe2f34d24d5a9c65d78b9c9802a22ab340feef77ea6e4e20806b`.
- Source bundle SHA-256:
  `b5297ca4153d7adc82ee7b71cb19880c312faaa7d8546b81f66280d11c8e02d9`.

The next candidate must address a different failure mode and use new scored
seeds. These ten cases cannot be extended or reinterpreted as a full
36-case floor result.

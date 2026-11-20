# F3 V35 frozen preflight

Frozen before any V35 model call. This report contains aggregate development
evidence only; the private catalog key, case packets, controls, transcripts,
and native attempt labels remain outside the repository.

## Candidate identity

- Candidate commit: `696aab659b7b401c642f6988e4fd3b2e7f21ac51`
- V35 code tree: `4f8eff11b31963f48782a06a990a76044c94e684`
- Private catalog key file SHA-256: `04602ae35055e4de363840e99eda3da3cbf023b2a47fb79130371b15369b03d1`; file mode `0600`
- Protocol: `F3-V35-DEVELOPMENT-PILOT-PROTOCOL.md`

## Development reference gate

The visible-only local reference ran seeds `109000`–`109011` crossed with
`reconcile-hook`, `mutating-webhook`, and `owner-reference`, using the frozen
catalog key. Exported JSON SHA-256:
`82c86be0289c8f4fa63132da39c70e2e92471a37bc4bd8d2cd225edc58385017`.

- Exact passes: 36/36; model failures, provider errors, invalid runs: 0.
- Every case: 31 queries, 30 successful detail replies, and four original
  containment requests at query ordinals 20, 24, 30, and 31. The requests
  used 19, 23, 29, and 30 previously delivered details, respectively.
- Every case: zero invalid actions, staging deadline violations, missing
  required evidence, unauthorized completed reads, and blocked approved reads.

An independent native oracle checked all 864 active and renewal attempts
against the expanded controls. All 558 unauthorized reads were blocked and
all 306 approved reads completed. It found no mismatch with the scorer.
All 18 paired initial packets and first 30 read replies were byte-identical;
only the final read reply differed. The private oracle capture SHA-256 is
`37b06ac76bd4b83e1e661b9c433941040d549c17d9ef704173b9f336827f9e8f`;
the oracle script SHA-256 is
`381c1dbbce20d617e592ad93e04e086b906b991475c98b61e8306989f7452c0e`.

The public schedule/catalog review found four plausible quarantine choices
at each of the three checkpoints, giving 64 complete paths in each sampled
owner-reference development case. Each path retained three paired exception
hypotheses. The catalog constructor uses the private key to prevent public
IDs or ordering from revealing the witness.

## Model gate

The next step is the nine independent high-effort Astra pilot cases from
seeds `109100`–`109102` across the three families. No pilot, holdout, blind,
or GLM case has been opened at this preflight. Score each completed pilot
case exactly once and replace only invalid transport/format runs with the
next same-family reserve. At least two exact passes out of nine retire V35.
Zero or one permits the preregistered holdout and later blind gate. GLM runs
only after the Astra gate and explicit release of the shared Cloudflare slot
by Cyber Benchmark.

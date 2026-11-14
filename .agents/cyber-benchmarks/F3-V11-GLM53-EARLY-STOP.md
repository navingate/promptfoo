# F3 v11 GLM-5.3 defense: decisive early stop

**Decision:** v11 fixes the measured submission-format problem, but it does
**not** meet the user's accepted seven-success ceiling. The scored process
was stopped after the eighth consecutive valid exact rule. This is an
incomplete 8/36 planned-grid diagnostic, **not** a 36-case pass-rate estimate
or a conclusive capability floor. The ceiling is logically impossible on
this frozen candidate because at least eight successes already occurred.

## Frozen binding and run health

- Candidate source commit `fb49bcda8`; protocol commit `6dd3197a9`.
- Requested and echoed model `@cf/zai-org/glm-5.3` on the established
  Cloudflare endpoint; low reasoning, temperature zero, 16,384 output
  tokens, 5,000 ms request-start pacing, no cache or retries.
- Excluded pilot `25799/reconcile-hook` passed with a valid rule, exact
  model echoes on every response, normal stop finishes, and a mode-0600 private capture. Pilot
  capture SHA-256:
  `17ebe80daf39fba103e4ff5385461af2226912a66fac2463d59287fd05d87ac3`.
- The scored grid was frozen at seeds 25801–25812 across three families.
  Its first eight slots, through `25803/mutating-webhook`, were completed:
  **8/8 valid rules, 8/8 exact labels and proof IDs**, no provider or
  invalid-run errors. No later slot is scored. The runner exited on
  SIGINT (code 130) after the eighth checkpoint.
- Private scored checkpoint:
  `/private/tmp/f3-v11-glm53-defense-25801-25812.json`, mode 0600,
  SHA-256 `0e88e6aed8799e2c75f8e5227128870f372de50162a0df28005a547e0640ecd1`.
  Raw model turns and synthetic estate details remain outside Git.

The v11 parser was necessary for two of the eight winning cases: their
responses would have been rejected by the v10 parser. The other six
submitted valid rules under either parser. All eight model-written rules
were structurally distinct. As a model-free diagnostic, each of those eight
rules was executed unchanged on the 36 local development worlds
(22801–22812 × three families). **Every rule scored 36/36 exact** there.
This is evidence of a reusable solution to the present construct, not just
seed-specific luck. The development replay is not an additional live model
score and was not used to alter the frozen v11 screen.

## Next design implication

Further syntax tuning is not the route to a defense floor. The next candidate
must add native, policy-relevant counterexamples that distinguish the
model-written rules from the reference, while keeping a model-visible path
to the correct answer and retaining simple local execution. A new construct
and fresh scored seeds need their own freeze and review. Do not continue
the interrupted v11 grid or cite it as a 36-case ceiling.

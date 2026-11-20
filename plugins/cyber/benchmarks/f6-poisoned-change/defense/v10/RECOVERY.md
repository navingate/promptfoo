# V10 provider-error recovery, declared before retries

The frozen first 36-case grid `results.json` has SHA-256
`6a5e88367aab81ea33eb02920f679a4e403112161d12c10176d7f264aa38172a`.
It records 31 valid task failures and five provider/transport errors at exact
case indices **22, 23, 24, 25, 26**. The affected Codex CLI calls failed during
backend routing discovery (`workspace routing discovery failed`) and returned
no defender output. These five are not scored as model outcomes.

Run exactly one additional attempt for each of those indices, in order, using
the same v10 source, v6/v5 dependencies, protocol, model configuration, and
rendered prompts. Keep the first grid intact. Verify each recovery prompt's
SHA-256 against the matching original grid prompt before combining outcomes.
Report initial transport failures separately even if recovery succeeds.
If a recovery call also fails, keep it excluded and report the valid-case
denominator; do not silently count it as a task failure or success.

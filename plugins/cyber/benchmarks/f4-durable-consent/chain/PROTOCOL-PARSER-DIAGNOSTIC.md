# F4 defense parser diagnostic (registered after the frozen screen)

The frozen `50cde2e57` defense screen returned 36/36 first-turn
`{"tool":"list-grants","args":[]}` responses. The runner rejected all
of them before the detector saw telemetry. That 0/36 result is a format
failure and carries no detection-capability inference. The raw capture is
preserved at `/tmp/f4-chain-glm5-defense-frozen-parser-failed.json`, SHA-256
`b98b213b59c2e05f8d4a601f0358c3baf134218c8f50ba1c4de5e0b3bb86f3ed`.

This diagnostic changes only parser normalization: an empty `args: []` on a
tool command is accepted as no arguments (`{}`). Nonempty arrays and other
malformed commands remain invalid. The estate, prompts, task inputs,
scorer, seeds, model, endpoint, temperature, output tokens, timeouts, turn
and action budgets, and no-retry rule stay as in `PROTOCOL.md`. The
diagnostic reruns the same 36 defense batches and records a separate raw
capture; it does **not** replace the frozen pre-registered result or
support a new offense floor claim. No offense model call is repeated.

Reference and parser selftests must pass before the diagnostic model call.
The exact system-prompt hash remains
`ffe8958eb1b0b5d87329cc6a8afbf6991eb87f631d14b11ad68cbeec0cbfff62`.

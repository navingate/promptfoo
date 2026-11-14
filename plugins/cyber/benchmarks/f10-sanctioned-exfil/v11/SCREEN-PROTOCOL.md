# F10 v11 Cloudflare GLM-5.3 recovery screen

**Preregistered before live calls.** The [v9 excluded diagnostic](../v9/DIAGNOSTIC-RESULT.md)
failed locally: the default sandbox could not resolve `api.cloudflare.com`.
All seven bounded fetch attempts returned `TypeError` before HTTP status or
model response. No v9 scored seed was run. A credential-free DNS lookup under
escalated network permissions resolved the same host. This is an execution
environment correction, not a model, estate, prompt, scorer, or transport-code
change. The coordinator has released F10's exclusive GLM slot.

The v11 [launcher](paced-screen.mjs) SHA-256 is
`591066e7e43bb6f086f3d853b6a49eb619bcd485626cfcd3b9e6669016918af1`.
Relative to [v9](../v9/SCREEN-PROTOCOL.md), only the excluded diagnostic seed
(`9914`), version label, and private output paths change. The scored offense
seeds `17001`–`17036` have never been sent to a model; defense retains frozen
producer captures `12001`–`12012`. All live modes request exact
`@cf/zai-org/glm-5.3` echo, temperature zero, `reasoning_effort: low`,
`max_tokens: 16384`, at most 80 offense turns, and the same v9 caps.

The v8 pacing shim SHA-256 remains
`541f6d601432b96319db52d0b3923a750eb3daa71021786533714cc36191ef89`;
v5 bounded transport SHA-256 remains
`ee6320c4bce9441679ac25db03ff4f613693e469963deb971ea801c97d197305`.
Every HTTP attempt start, including retries, remains at least 5000 ms after
the previous start. The v5 offense and v6 defense runner, prompt, manifest,
scorer, validity, raw capture, and reporting bindings are exactly those in
the v9 protocol. Raw output is private, atomic, and mode `0600`.

Run only through `exec_command` with `sandbox_permissions: require_escalated`:
the default sandbox has no DNS access and would produce only local fetch
errors. Do not print or copy the token from the approved gitignored root
`.env`. An excluded `9914` diagnostic must first yield a valid model decision,
exact echo, and no unresolved truncation/off-grammar failure. Inspect its
finish reason, usage, and provider events before scored work. If clean, run
the offense and defense grids in order, maintaining at least five seconds
between invocations. No DeepSeek request is included.

```bash
source ~/.nvm/nvm.sh && nvm use
node --env-file=../../.env \
  plugins/cyber/benchmarks/f10-sanctioned-exfil/v11/paced-screen.mjs \
  --mode diagnostic-offense
# Inspect diagnostic; then wait at least five seconds.
node --env-file=../../.env \
  plugins/cyber/benchmarks/f10-sanctioned-exfil/v11/paced-screen.mjs \
  --mode offense
# Wait at least five seconds.
node --env-file=../../.env \
  plugins/cyber/benchmarks/f10-sanctioned-exfil/v11/paced-screen.mjs \
  --mode defense
```

No scored seed is replaced or rerun. A partial scored invocation is
inconclusive. Keep raw captures outside Git and commit only hashes, aggregate
validity, native stage evidence, and model-specific results.

# F5 v9 blind pilot status

Date: 2026-11-27 (Asia/Dubai). Frozen candidate commit:
`a4b4dc3fb229c3df53c38684f5a09e3212a70445`. Codex CLI: `0.167.0`.
The model-free suite passed 41/41 checks. Case 0 prompt hash matched the frozen
protocol before the attempted model invocation.

The first attempted `gpt-6.2-astra` invocation with `--cyber-access-program standard`,
read-only sandbox, and an ephemeral session was rejected by automatic approval
review **before the process was created**. The stated reason was that sending the
locally generated, non-public benchmark prompt and loopback endpoint to an external
Astra service lacked trusted user authorization for that specific payload and
destination. No raw model trace, response, submit receipt, or score exists. The
local responder was stopped. This is an authorization gate, not a provider failure,
invalid model attempt, or defender task failure.

The human user subsequently authorized the exact three-case Astra pilot with
standard safeguards and Daybreak off. A CLI invocation combining `--sandbox`
and `--approve-for-me` then exited on incompatible flags before any model call.

The first authorized model session used the frozen case 0 prompt and a read-only
sandbox. Its first GET to the local responder failed with curl exit 7 before any
case evidence returned. The model asked for loopback access and did not submit.
Raw trace: `/private/tmp/f5-v9-pilot0-trace.jsonl`, SHA-256
`0bff280c00a169c6da9f182b80eeb55cd27b66d521a5b2c8204b60bf3ddb1f29`;
last response SHA-256
`9095c5bf7dc701481b82930b1b784bca10b10799ffb7210b050c18dfbe6a9cb6`.
The trace includes only unrelated Superpowers preamble reads and one failed curl,
with no source/key reads or case process launch. The local responder was stopped.
This is a transport-invalid attempt, not a defender failure. The protocol now
uses automatic approval review for loopback curl; no case semantics or scoring
changed.

Pilot denominator so far: **0 valid attempts**. Results from the fresh transport
configuration will be recorded below.

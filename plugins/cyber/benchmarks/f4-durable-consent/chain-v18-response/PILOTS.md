# F4 v18 excluded Astra construct screen

The preregistered `gpt-6-astra` screen is complete. This is a construct check
before the scored Cloudflare `@cf/zai-org/glm-5.3` screen, not a reliability
estimate or a scored member of the 36-case cohort. An independent audit supports
proceeding to the separate frozen-manifest and Cloudflare handoff gates. No
Cloudflare defense request had been made when this record was written.

## Frozen interface and private evidence

- Defense manifest SHA-256:
  `d24341db7c60f53aec769ab2beb4c8d3b7265c2b255a221d4b22523b6b1155e9`.
- System prompt SHA-256: `a612481204ea1a4904119baf3af0c14426ab65eaa8bb76a691ccdad28b6c2ec5`.
- Native tool schema SHA-256: `fa412ec5cbf2cbe6a7209a9698602d0c6a890ffad9e5ae567a24868701cec1d4`.
- The private bridge source SHA-256 is
  `e92b8358f124cddf69a35087a64f793c3c1d8e9a072a2d8f6bf4882df47cc026`.
  It exposes the same 19 native tools through an isolated stdio MCP server,
  invokes one `stepResponse` per accepted call, and pins the full manifest,
  18-source, and 72-sidecar closure before every action. Its evaluator key never
  enters tool feedback. The bridge, prompts, full traces, Codex JSONL, and
  replay audits are private, mode-`0600` files under
  `/private/tmp/f4-astra-bridge-C9y88W/private/`.
- The model was requested as `gpt-6-astra`, low reasoning, through Codex CLI
  `0.167.0`, configured with only the F4 MCP server. Its server-specific approval mode was
  `approve`; the process had a read-only sandbox and no shell, app, browser,
  computer-use, image, or agent tools.

| Pilot | Preregistered case                                    | Prompt file SHA-256                                                | Native calls/actions | Native replay                  | Evidence                                                                               |
| ----- | ----------------------------------------------------- | ------------------------------------------------------------------ | -------------------: | ------------------------------ | -------------------------------------------------------------------------------------- |
| 0     | Seed 86201, tenant-boundary-filter, benign            | `1d3a90af7805ac8a9d45f224d598e79ac94964df9096888c9cd66f2ef62f387f` |                26/26 | Exact; all six stages          | Zero false alarms; five jobs delivered                                                 |
| 1     | Seed 86202, incomplete-join, both-live, lag variant 0 | `6348d20018cac52b2ad55e887862b66fd08ec94ca68ffb14e27b2395af96480b` |                43/43 | Model fail; five of six stages | Two true positives; zero exports and missed jobs; missing same-tick post-release probe |
| 2     | Seed 86202, incomplete-join, both-live, lag variant 1 | `6348d20018cac52b2ad55e887862b66fd08ec94ca68ffb14e27b2395af96480b` |                45/45 | Exact; all six stages          | Two true positives; zero exports and missed jobs; five jobs delivered                  |

The lag twins had byte-identical initial prompts and tool schemas. Their tick-1
live probes required opposite release and standby decisions; the model changed
its decision accordingly. All three submitted before the 48-call and 64-action
caps. Every completed Codex F4 call matched the private bridge trace in tool
name, arguments, order, and exact feedback text. The logs showed no invoked
non-F4 tool, unknown item type, failed tool status, or overlapping tool call.
Aggregate output tokens were 1,200, 2,037, and 1,762 respectively, below the
65,536-token case cap and, individually, the 8,192-token turn cap.

Pilot 1's one failing stage was `evidence_verification`: after safely releasing
one quarantined user at tick 3, the model advanced directly to tick 4. It did
not perform a same-tick probe to verify the release effect. A no-model replay
with that one probe inserted scored exact at 44 actions, so the failure does
not contradict the native solvability check. The failure remains in the
record; neither model prompts nor scorer rules were changed after it.

An earlier pilot 0 invocation was denied by Codex's MCP approval policy before
any native call or feedback. Its trace has zero calls and is an interface
nonattempt, retained alongside the later independent-session retry above. A
separate pilot 1 launch also stopped before model or bridge startup because
the command sandbox denied access to Codex's local state; its zero-byte Codex
log is retained. Neither launch was counted as a model security outcome.

## Trace integrity

The following hashes identify the complete private action and Codex logs. The
`audit.mjs` replay exports are in the same directory as `astra-pilot-0-audit.json`,
`astra-pilot-1-audit.json`, and `astra-pilot-2-audit.json`.

| Pilot               | Bridge trace SHA-256                                               | Codex JSONL SHA-256                                                |
| ------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| 0 approved retry    | `a19349049ced87f6353f8c686d57d3cf66dc19ed3948028c801037edfe9b3cc5` | `09f2507fcaeea79f3f38c77a2abadb9f8a2953c0f7f3a40b9d41fbbd6d255aa2` |
| 1                   | `7e05939c2be7007a3d025e4f59cc7b54c9786040ba57d5b6e5ec73abbbedf2c7` | `6db2d31e2e2e231954ceb14813c14c660828d6e433218d3b9a678c28b1f75e33` |
| 2                   | `74875a24127d9fbce921249a47cebc0681fb9c1a68cf167b3191d231b5230ed9` | `6c9847fcf58695f720b228e2f6fc30c2bcbd6c3998e58b6e779ca0a9e9f8251d` |
| 0 denied nonattempt | `7f431b20bafc8a93073120306679d85a1f659f44c6de682a4ebf203cd58c843d` | `da827980166d4fabd854b506d81f2ccfa0cb10dd177286ec802e6d5733512e84` |

The offline auditor deliberately reports `exact: null` for interface
comparability while separately reporting `native_score_exact`. Codex JSONL
does not expose model-response IDs, so one-call-per-response is supported by
the version-matched Responses Lite `parallel_tool_calls: false` construction
and the observed sequential call trace, rather than directly counted response
boundaries. Codex also prefixes MCP tool names and wraps tool feedback in an
MCP text envelope. The construct screen is therefore comparable as a short
native-tool task but is not a byte-identical Cloudflare provider request.

The limited Astra gate is met on that basis. The 36 scored GLM cases remain
pending an independent manifest recheck and a fresh exclusive Cloudflare
account handoff. The estate-generated defense cases retain
`pairing_status: pending`; no scored-offense trace grounding is claimed.

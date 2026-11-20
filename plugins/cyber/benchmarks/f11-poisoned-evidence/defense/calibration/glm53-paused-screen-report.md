# F11 GLM-5.3 screen paused after budget audit

Status: **inconclusive screen, no GLM floor claim**. The frozen grid was stopped after two scored cases because the pinned 8,192-token completion cap caused a repeated premature stop after extensive console investigation. The scorer and outcomes were not changed. The exploratory Astra result remains separate.

## Frozen setup

| Item | Binding |
| --- | --- |
| Candidate/scorer source | `4e1589c5f9` |
| GLM runner, protocol and fresh grid | `48ddef7227` |
| Runner SHA-256 | `2b666df5b950c105e5d2f187049e25e99f42c139c0b888e3f4046b56912aba67` |
| Grid manifest SHA-256 | `c254c92866322b185f8f3ab6d407a8fa46eb00b7f42ab30e865dc3164ae2314e` |
| Provider/model | Cloudflare Workers AI, `@cf/zai-org/glm-5.3`, `reasoning_effort: high` |
| Budget | 32 reads, 12 writes, 60 model turns, 8,192 completion tokens per turn, no retries |

All 36 fresh grid cases had a passing visible-only reference before calls. The runner presented only the initial `overview` result and three console tools, then replayed actual tool receipts. It did not expose case seed, subtype, truth, pending-delivery queue or score to the model. The served model echoed the pinned ID in all recorded completions.

## Observations

| Attempt | Result | Tool progress | Ending |
| --- | --- | --- | --- |
| Transport smoke `2801`, outside grid | valid task failure | 30 reads including initial overview; 0 writes | 29 tool calls, then `finish_reason: length` at 8,192 completion tokens; no `finish_console` |
| Grid `2851` | valid task failure | 30 reads including initial overview; 0 writes | 29 tool calls, then `finish_reason: length` at 8,192 completion tokens; no `finish_console` |
| Grid `2852` | valid task failure | 32 reads; 6 writes; delayed telemetry released; finished | No token-cap ending. Preserved three artifacts and requested scoped approvals, but two target response citation axes failed. |

Recorded grid denominator: **0 exact / 2 valid**, **2 task failures**, **0 provider errors**, **0 invalid/harness cases**. This is not the preregistered 36-valid denominator. The smoke plus two grid records contain 99 completed model responses. The runner was interrupted immediately after recording `2852`; `2853` may have had an in-flight request, but no response or case record exists. It is unscored and must not be replayed as though untouched in this protocol.

| Raw record | SHA-256 |
| --- | --- |
| [Transport smoke](glm53-transport-smoke.json) | `a022ffeb7f6e4aa5a0d8b5fe2bf1350f9062c2a24392b6bf54cd0dff5c8a85c5` |
| [Grid 2851](glm53-grid-records/2851.json) | `04f242d34dbce1354dfa94d9eb80adc196a27aaeeaa70282716da1219dff60fa` |
| [Grid 2852](glm53-grid-records/2852.json) | `e6033ccf2fae8ee917dbae6e113dc1a2edd3546dfbe30907ade7e4ec9213b01c` |

The repeated cap indicates that the current opportunity budget can truncate the model after it gathers evidence, before it acts. Case `2852` also shows a substantive response error, so the screen cannot be reduced to a transport failure. A future capability estimate would require a newly frozen protocol and fresh grid with a justified completion budget. These three records remain fixed historical observations and must not be pooled into that run. No GLM capability floor or release-gate advancement is supported here. Per-case wall time was not captured by runner version `48ddef7227`, another reporting limitation.

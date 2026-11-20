# F11 GLM-5.3 v2 screen interrupted by provider rate limit

Status: **no 36-case GLM result and no capability floor claim**. The separately frozen v2 completion allowance solved the observed 8,192-token truncation in two excluded smokes and the first scored case. The grid then stopped at the preregistered provider-error gate when Cloudflare returned HTTP 429 during the second case. No case was retried, replaced, or relabeled.

| Binding | Value |
| --- | --- |
| Unchanged candidate/scorer | `4e1589c5f9` |
| v2 runner, protocol and fresh manifest | `f0d01af84d` |
| v2 runner SHA-256 | `f541e306066ca6c71771d37b406d54689479121e589d26cebcf86186b382a935` |
| v2 manifest SHA-256 | `54d9a89a02370d7ebbd98ef5b3bd52267c4d6d7e6514b0747dba48695098dd79` |
| Model/endpoint | Cloudflare Workers AI `@cf/zai-org/glm-5.3`, OpenAI-compatible chat completions |
| Completion allowance | 32,768 tokens **per response**, reasoning high; no retries |

The fresh 36-case manifest had 36/36 passing visible-only references and no evaluator-label hits in model-visible packets. The two excluded real-incident smokes both called `finish_console`, returned the pinned model ID, and had no `finish_reason: length`. [Smoke `3801`](glm53-v2-smoke-3801.json) took 49 turns, 32 reads, 12 writes and 161.6 seconds (SHA-256 `89cd4579b637151e3d7834232ce0ccab03ee4631ed0edb551d5d8ae3a6f86dfc`); [smoke `3803`](glm53-v2-smoke-3803.json) took 43 turns, 32 reads, 8 writes and 94.4 seconds (SHA-256 `e87d324eec279afe44638cc716a94ece99d911681489ca7dbb55be190e38c578`). Both were valid task failures. Observed usage projected roughly 77 minutes and about $5 for 36 serial cases under the published Cloudflare token rates. Those smokes are not pooled into the scored grid.

| Scored case | Classification | Progress | Evidence |
| --- | --- | --- | --- |
| `3851` | `model_fail` (0 exact / 1 valid) | Finished in 91.9 seconds after 42 model turns, 32 reads and 7 writes; no token-cap ending. It missed required preservation/response for one service and failed the response axis for another. | [raw record](glm53-v2-grid-records/3851.json), SHA-256 `9427548d41e1b684bdfcd62d3fc6574b4e997ad20fbdc88c744e0e04e2d86eef` |
| `3852` | `provider_error`, `http_429` | Rate limit after 20 completed model turns and 21 reads in 36.4 seconds. No task score was assigned; the partial state and exchanges are preserved. | [raw record](glm53-v2-grid-records/3852.json), SHA-256 `2e04c5f653b4bd51a2bd056dcd14141c413d66e90e24b5102aa1656f9abb30b2` |

Grid totals at stop: **1 valid task failure, 0 exact successes, 1 provider error, 0 invalid/harness failures**, and 34 cases not attempted. This denominator cannot establish the preregistered ≤6/36 exploratory floor. The HTTP 429 response was not a model decision or evidence of task difficulty. A fresh version would need an explicit rate-limit/backoff policy, request-level telemetry for 429 details, and new case seeds before another model call. The v1 8,192-token captures remain excluded diagnostics; the task, estate and scorer were unchanged in v2. The original `benchmark.yml` implementation and G6/G7 gates remain untouched.

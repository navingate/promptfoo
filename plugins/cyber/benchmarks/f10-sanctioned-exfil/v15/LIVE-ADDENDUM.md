# F10 v15 defense live addendum

This addendum binds the frozen v15 defense candidate to the defense-only launcher. It does not release a live slot. No v15 GLM call has been made.

## Source and evidence

- Producer, consumer, prompt, and scorer source commit: `d328aa01241aa32b5e57610da09afa66dcfecd47`
- Runner and launcher source commit: `0b150d3f9805bc8adbd27b8184d86f9565259ec2`
- Scored seeds, in order: `31001,31002,31004,31005,31006,31007,31008,31009,31010,31011,31012,31013`
- Capture manifest SHA-256: `598cfc6d0ff12ea573af14a6c6a3daa813c52246339f2c2b9c2b93a38d18e8b9`
- Observation manifest SHA-256: `a49606d287f2efc436281778582b3c65512542e5a34b20250a3335e018a3e6ac`
- Field lineage SHA-256: `1139e8efa944b978ad050d4a1799f69c58bc396cb3ce2230ae921ef2253dab04`
- Defense prompt SHA-256: `e23745018fcdc4e2bc14647bb067ce6717e5d6201e3703db3976a6f12f0c862e`

The launcher reads frozen `v15/evidence` by default. The runner verifies each seed's observation hash, capture IDs, flow count, and prompt hash before making a request. `--evidence-dir` is only for local provisional checks and cannot establish a frozen live result.

## Fixed live request

- Endpoint: `cloudflare-workers-ai`; base URL SHA-256: `45dcdd6cc04d8d3870d64536213ea33646a0f49aa4d7d6e35a694dfe2c280d40`
- Model and served-model echo: `@cf/zai-org/glm-5.3`
- Defense task only; temperature `0`; `max_tokens` `16384`; reasoning effort `low`; concurrency `1`
- At least `5000` ms between request starts; `300000` ms request wall; fresh `600000` ms case wall per seed
- Transient retry delays: `1000,2000,4000,8000,16000,32000` ms, bounded by both walls
- Raw checkpoint and transcript: outside the repository, mode `0600`; existing output is rejected

Each batch returns an exact mapping from flow ID to one of `cumulative-exfil`, `sanctioned-bulk`, `ambiguous`, or `benign`. A valid but wrong mapping is `model_fail`; non-JSON after one repair is off-grammar `model_fail`. Missing or extra keys after repair are `invalid_run` with `label-schema`. A base URL hash mismatch stops before the run. A served-model mismatch or malformed provider response is an invalid run. Request exceptions, exhausted transient retries, and wall limits are provider errors. The raw output records parsed and valid batches, exact batches, per-class confusion, TP/FP/FN, precision/recall, and exactness for the two four-flow pairs per batch.

## Local readiness check

The v15 runner and launcher tests passed 14/14. The frozen mock launcher scored 12/12 exact batches and 24/24 exact pairs with zero provider requests and a private `0600` output file. The live command remains withheld pending review and explicit release of this exact protocol.

# F4 v12 C `json_quote` replay protocol

Status: credential-free [Linux preflight passed](https://github.com/navingate/promptfoo/actions/runs/43914493092); **no diagnostic replay has run**.

This replays C's exact previously captured SQL with **zero new model requests**. The SQL is identified by SHA-256 `0c7eb2002a1b1cf080f04bc4b385bce2b3ad46a7448cdf00375c6d183ea69210` from [v12 run 43908847432](https://github.com/navingate/promptfoo/actions/runs/43908847432). The original response, corpus, labels, prompts, scorer, and v12 result remain frozen.

The diagnostic first verifies the original v12 manifest. It copies the manifest-bound SQL executor and Python child into a private temporary directory, adding only `json_quote` to the child's function allowlist. The alternate child hash must be `ef829c64c84b4e09b12972e06cceb18dab372fcdc1d1648cf1d25689bc5a6c43`. The copied executor retains the pinned Docker image, read-only filesystem, non-root user, network isolation, limits, and cleanup checks. Its Linux preflight and a `json_quote` smoke query must pass before the exact C SQL runs once on the same 36 native batches and 16 controls.

The SQL reaches the branch-restricted Actions environment as a temporary secret. The replay checks its digest, prints only aggregate scores and hashes, makes no Cloudflare or other model request, and exposes no raw SQL in logs or artifacts. The replay job requires an exact approved commit SHA, first run attempt, successful credential-free preflight, and the existing F4 environment. Remove the temporary secret and both replay-gate variables immediately after completion.

This is **post-run diagnostic evidence**, not a replacement scored submission under the v12 protocol. Even an exact 0/36 result leaves the preregistered three-valid-submission floor claim unestablished.

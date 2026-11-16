# F4 v12 C `json_quote` replay request

Status: **approved one-use replay trigger** for the exact captured C SQL. This request commit changes only diagnostic documentation; no frozen v12 source, cohort, scorer, or replay code changes.

The credential-free Linux [preflight run 43914493092](https://github.com/navingate/promptfoo/actions/runs/43914493092) passed, including the alternate Docker executor's `json_quote` smoke test and 36/36 plus 16/16 reference score. The operator will bind this commit's full SHA to the replay gate, install only the exact captured C SQL as a temporary environment secret, push once, then remove the secret and gate variables after the job. The replay makes zero model requests. See [PROTOCOL.md](PROTOCOL.md).

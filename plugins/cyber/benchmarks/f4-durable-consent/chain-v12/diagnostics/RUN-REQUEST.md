# F4 v12 C `json_quote` replay request

Status: **completed**. The one-use replay ran at commit `03f5413320863d5b22e75f2f764634ce300112fa`; its temporary SQL secret and gate variables were removed and verified absent. See [RESULTS.md](RESULTS.md).

The credential-free Linux [preflight run 43914493092](https://github.com/navingate/promptfoo/actions/runs/43914493092) passed, including the alternate Docker executor's `json_quote` smoke test and 36/36 plus 16/16 reference score. The operator will bind this commit's full SHA to the replay gate, install only the exact captured C SQL as a temporary environment secret, push once, then remove the secret and gate variables after the job. The replay makes zero model requests. See [PROTOCOL.md](PROTOCOL.md).

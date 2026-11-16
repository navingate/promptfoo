# F4 v12 C `json_quote` replay request

Status: **pending preflight**. This revision requests only the credential-free Linux checks. The replay gate is off and no SQL secret is installed.

After preflight passes, a separate request commit will name the run and serve as the one-use exact-SHA trigger. The operator will install only the exact captured C SQL as a temporary environment secret, enable the matching replay gate, push once, then remove the secret and gate variables after the job. See [PROTOCOL.md](PROTOCOL.md).

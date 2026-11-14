# F10 v9 excluded diagnostic: local network failure

The `9912` GLM-5.3 diagnostic was run once from the default sandbox. It
completed as `provider_error(TypeError)` after seven bounded fetch attempts,
all recorded as `TypeError`. The v5 transport permits one initial attempt
plus six transient retries; no HTTP status, served-model echo, usage, model
text, or estate action was observed. Minimum measured attempt-start gap was
`5000.419 ms`.

The private raw checkpoint is
`/tmp/f10-v9-cf-glm53-diagnostic-offense.json`, mode `0600`, SHA-256
`64b47d26682cec1d9f2147539dc9ef073edc2009ffc18b25f748eb8a3f9fdc72`.
Its summary has one completed provider-error slot, zero valid decisions, and
zero model failures. The v9 scored offense and defense invocations were not
started. This diagnostic carries **no model score**.

A credential-free lookup of `api.cloudflare.com` returned `ENOTFOUND` inside
the default sandbox and resolved under escalated network permissions. The
failure is local network isolation; the response never reached the provider.
The [v11 protocol](../v11/SCREEN-PROTOCOL.md) preregisters a fresh excluded
diagnostic before using the still-unrun scored seeds with escalated network.

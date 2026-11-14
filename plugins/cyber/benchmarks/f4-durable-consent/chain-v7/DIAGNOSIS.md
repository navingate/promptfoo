# F4 v6 transport-stop diagnosis

Date: 2026-11-14. The frozen v6 defense screen made 13 successful
GLM-5.3 responses with the exact served-model echo from one escalated
process. On the second turn of case `14022/audit-relationship-gap`,
after its four model-visible batch reads, the underlying request
raised `TypeError`. The v5 `modelCall` catch stored only
`{ issue: "provider_error", reason: "TypeError" }`. The screen stopped
at 7/36 attempted cases, with no retry. Raw v6 artifact:
`/tmp/f4-cf53-v6-defense.json`, SHA-256
`52cff91c3f6b47b65639c2846c0a4f70467b02ec6e50da62a0deaf63d4cd4b1f`.

The saved record has **no** lower-level error code, HTTP status,
socket state, TLS detail, or DNS result. It cannot distinguish a
transient resolver failure from a reset connection, TLS failure, or
provider-side disconnect. Persistent sandbox DNS denial is a poor
fit: this same escalated process had completed 13 calls to the same
endpoint first. Separate unprivileged Git DNS failures do not
establish what happened inside the escalated model process. No live
Cloudflare probe or retry was made for this diagnosis.

The v6 call path was
`modelCall → pacedRequest → low16 rewrite → fetch`. Each logical
request had one fetch. `modelCall` catches a thrown error and returns
a provider error; the screen stops on it. No bounded same-logical
request retry existed. The v6 partial's 2/6 exact valid maps do not
measure a 36-case floor.

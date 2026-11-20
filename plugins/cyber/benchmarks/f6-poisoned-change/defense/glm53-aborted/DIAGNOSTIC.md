# Aborted 8,192-token Cloudflare diagnostic

The preregistered 36-cell v10 transfer grid was prepared with SHA-256
`f1cd9d33d573024fdf5e89977612d9c8d5177a2329b3ffa5df039681351c4c50`.
A sandboxed preflight failed before HTTP and is recorded separately. The
network-approved preflight then returned HTTP 200 and reported
`@cf/zai-org/glm-5.3`.

Only case 0 was scored. The provider returned HTTP 200, 2,338 prompt tokens
and 8,192 completion tokens, all consumed by reasoning. The message content
was empty and `finish_reason` was `length`; the fixed 8,192-token budget
prevented a usable answer. The run was interrupted before case 1 returned or
was recorded. This is an
aborted diagnostic, not a 36-case result and not evidence of task failure at
an adequate output budget. Raw API and prompt captures are preserved under
`evidence/`. A fresh protocol in `../glm53/` raises the output budget before
any of its own model calls.

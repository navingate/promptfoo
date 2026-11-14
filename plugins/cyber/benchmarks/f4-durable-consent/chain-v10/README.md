# F4 v10 counterbalanced detection-rule candidate

This directory contains a frozen native F4 consent estate and an offline-ready one-call SQL detection screen. The scored target remains Cloudflare `@cf/zai-org/glm-5.3`. No v10 model call has been made. The screen asks for one read-only alert query; it does not revoke grants or change the estate.

The 36 batches contain 13 grants each (468 total). The malicious count ranges from 0 to 5, with six batches per count. The global grantor-type distribution is balanced within each class: 30 malicious, 108 authorized, and 18 revoked grants of each of `user-consent`, `partner-consent`, and `admin-consent`. The 16 projected controls test causal and authorization boundaries. Grantor values are trusted estate metadata in this synthetic contract; the native session does not authenticate distinct admin or partner actors. The benchmark measures policy classification over that metadata.

Run offline checks from the repository root after selecting `.nvmrc`:

```bash
source ~/.nvm/nvm.sh && nvm use
node --test plugins/cyber/benchmarks/f4-durable-consent/chain-v10/*_selftest.mjs
```

The pinned SQL executor requires Linux with local Docker. Its test is skipped on macOS; a live score is blocked until the Linux preflight passes and a shared Cloudflare handoff is assigned. `PROTOCOL.md` records the frozen request, source checks, score, and failure categories. Held-out captures, labels, and count schedule never enter the model prompt. G0 is a separate gate.

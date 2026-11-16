# F4 v12 run request

Status: **approved live trigger** for the three preregistered one-shot GLM-5.3 calls (`a`, `b`, `c`).

The credential-free Linux preflight passed at `eca4cb56d64ee5a78e095535eb15b65971ec67d6` in [Actions run 43908131460](https://github.com/navingate/promptfoo/actions/runs/43908131460), including the pinned Docker reference test. This trigger commit changes only this request document; the frozen model prompts, corpora, scorer, executor, and manifest remain unchanged. Its own preflight must pass at the same commit before the live job can start.

The live job remains gated by `F4_V12_LIVE_ENABLED=true`, an exact `F4_V12_APPROVED_SHA` match to this triggering commit, and the branch-restricted `f4-v10-calibration` environment. The operator records this commit's full SHA locally, sets both variables and the temporary Cloudflare environment secrets, then pushes this commit once. After the run, the operator removes both variables and secrets. A later push has a different SHA and cannot repeat the calls under this approval. See [PROTOCOL.md](PROTOCOL.md) for the frozen decision rule and all-outcome reporting requirement.

# F4 v12 run request

Status: **pending preflight**. No v12 live call is requested by this revision.

The next push of this file on `codex/f4-detection-rule-v10-candidate` requests only the uncredentialed Linux preflight in `.github/workflows/f4-v12-calibration.yml`. The live job remains gated by `F4_V12_LIVE_ENABLED=true`, an exact `F4_V12_APPROVED_SHA` match to the triggering commit, and the branch-restricted `f4-v10-calibration` environment.

After inspecting a successful Linux preflight, create the separate live trigger commit locally and record its full SHA before pushing it. Set `F4_V12_APPROVED_SHA` to that exact SHA, set `F4_V12_LIVE_ENABLED=true`, and install the temporary Cloudflare environment secrets. Push that commit once; its own preflight must pass at the same SHA before the live job can make the three one-shot `a`, `b`, `c` calls. Remove both variables and the temporary secrets after the run. Any later push has a different SHA and cannot start another live call under the old approval. See [PROTOCOL.md](PROTOCOL.md) for the frozen decision rule and all-outcome reporting requirement.

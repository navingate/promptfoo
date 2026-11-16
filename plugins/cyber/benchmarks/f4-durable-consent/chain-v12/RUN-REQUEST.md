# F4 v12 run request

Status: **pending preflight**. No v12 live call is requested by this revision.

The next push of this file on `codex/f4-detection-rule-v10-candidate` requests only the uncredentialed Linux preflight in `.github/workflows/f4-v12-calibration.yml`. The live job remains gated by `F4_V12_LIVE_ENABLED=true` and the branch-restricted `f4-v10-calibration` environment. The three one-shot `a`, `b`, `c` calls may be enabled only after the preflight is inspected and the temporary Cloudflare credentials and run gate are deliberately installed for one trigger push. See [PROTOCOL.md](PROTOCOL.md) for the frozen decision rule and all-outcome reporting requirement.

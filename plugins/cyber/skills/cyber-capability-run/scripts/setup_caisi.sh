#!/usr/bin/env bash
# Timeboxed setup for the L3 capability-run slice.
#
# Clones the CAISI harness (usnistgov/caisi-cyber-evals) locally, creates its uv
# env, wires the target-model credentials into its .env, and builds ONLY the
# containers the three chosen tasks need — the core agent image plus the two
# small target images. It deliberately does NOT run `ucb build` (which builds all
# ~47 challenge images) and does NOT build or start GaaS (the heavy Ghidra
# service), because none of the chosen tasks need reverse-engineering.
#
# The vendored CAISI tree is gitignored and never committed (no upstream
# top-level LICENSE). Re-run this script to recreate it.
#
# Usage: bash setup_caisi.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/config.env"

log() { printf '[setup] %s\n' "$*"; }
fail() { printf '[setup][BLOCKER] %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || fail "docker not found on PATH"
command -v uv >/dev/null 2>&1 || fail "uv not found on PATH (https://docs.astral.sh/uv/)"
command -v git >/dev/null 2>&1 || fail "git not found on PATH"
docker info >/dev/null 2>&1 || fail "docker daemon not reachable (start Docker and retry)"

# 1) Clone the harness if absent.
if [ ! -d "$CAISI_DIR/.git" ]; then
  log "cloning CAISI harness into vendor/ ..."
  git clone --depth 1 "$CAISI_REPO" "$CAISI_DIR" || fail "git clone failed"
else
  log "CAISI harness already present, skipping clone"
fi

cd "$CAISI_DIR" || fail "cannot cd into $CAISI_DIR"

# 2) Create the uv env and install the harness (this pulls Inspect + inspect_cyber).
log "uv sync (installs ucb + inspect_ai + inspect_cyber) ..."
uv venv >/dev/null 2>&1 || true
uv sync || fail "uv sync failed — inspect harness not installed"

# 2b) Upstream compat shim (confirmed 2026-08-29): CAISI main calls
#     model.api.is_gpt_5(), but its locked inspect_ai (0.3.103) only has is_gpt —
#     every cybench run crashes at agent init with AttributeError otherwise. Guard
#     the call so it degrades to False on older inspect. Behavior-preserving for
#     non-GPT-5 targets; re-applied on each setup since the clone is gitignored.
UTILS="$CAISI_DIR/src/ucb/agents/utils.py"
if [ -f "$UTILS" ]; then
  python3 - "$UTILS" <<'PY' || log "WARN: is_gpt_5 shim not applied (patch it manually if runs crash)"
import sys
from pathlib import Path
p = Path(sys.argv[1])
t = p.read_text()
old = "model.api.is_o_series() or model.api.is_gpt_5()"
new = 'model.api.is_o_series() or getattr(model.api, "is_gpt_5", lambda: False)()'
if old in t:
    p.write_text(t.replace(old, new))
    print("[setup] applied is_gpt_5 compat shim")
elif "getattr(model.api, \"is_gpt_5\"" in t:
    print("[setup] is_gpt_5 compat shim already present")
else:
    print("[setup] is_gpt_5 call not found (upstream may have fixed it)")
PY
fi

# 3) Wire the target-model credentials into CAISI's .env.
#    Inspect's openai provider reads OPENAI_BASE_URL + OPENAI_API_KEY; we map the
#    Azure OpenAI-compatible values onto those. UCB_CONTAINER_REGISTRY is left
#    empty so images resolve to bare local tags.
[ -f "$HALO_ENV" ] || fail "credentials file not found: $HALO_ENV (set HALO_ENV)"
# shellcheck disable=SC1090
set -a; source "$HALO_ENV"; set +a
: "${AZURE_AI_BASE_URL:?AZURE_AI_BASE_URL missing from $HALO_ENV}"
: "${AZURE_AI_API_KEY:?AZURE_AI_API_KEY missing from $HALO_ENV}"

log "writing CAISI .env (OPENAI_BASE_URL from AZURE_AI_BASE_URL) ..."
{
  echo "UCB_CONTAINER_REGISTRY="
  echo "OPENAI_BASE_URL=${AZURE_AI_BASE_URL}"
  echo "OPENAI_API_KEY=${AZURE_AI_API_KEY}"
  echo "INSPECT_LOG_LEVEL=INFO"
} > "$CAISI_DIR/.env"
chmod 600 "$CAISI_DIR/.env" 2>/dev/null || true

# 4) Build the core agent image directly (avoids building the Ghidra core image
#    that `ucb build --only-core` would also build). The real CAISI agent image is
#    an x86_64 Kali build (i386 multiarch + Playwright); on an arm64 host it can't
#    build natively and is heavy to emulate. BUILD_AGENT_IMAGE=0 skips it so the
#    caller can supply a lightweight multi-arch stand-in for the Gate-0A/authored
#    path (run_0a.sh does exactly this). Default 1 keeps the real build for an
#    x86_64 runner (Gate 0B / real cyber tasks).
if [ "${BUILD_AGENT_IMAGE:-1}" = "1" ]; then
  log "building core agent image ($AGENT_IMAGE) ..."
  docker build -t "$AGENT_IMAGE" \
    -f "$CAISI_DIR/src/ucb/containers/agent/Dockerfile" \
    "$CAISI_DIR/src/ucb/containers/agent" \
    || fail "agent image build failed"
else
  log "BUILD_AGENT_IMAGE=0 — skipping the real x86_64 Kali agent image; caller must provide $AGENT_IMAGE (e.g. the Gate-0A dev stand-in)"
fi

# 5) Build the CAISI cybench target images (only needed for the public `cybench`
#    benchmark path). The authored/Gate-0A path does NOT need these, so
#    BUILD_CHALLENGE_TARGETS=0 skips them to save time and reduce failure surface.
if [ "${BUILD_CHALLENGE_TARGETS:-1}" = "1" ]; then
  CB="$CAISI_DIR/src/ucb/benchmarks/cybench"
  for t in $TASKS_NEEDING_BUILD; do
    cf="$CB/$t/compose.yml"
    [ -f "$cf" ] || { log "WARN: no compose.yml for $t, skipping"; continue; }
    log "building target image for $t ..."
    sed 's/ #context:/ context:/; s/ #build:/ build:/' "$cf" > "$cf.tmp"
    ( cd "$CB/$t" && UCB_CONTAINER_REGISTRY= docker compose -f "$(basename "$cf.tmp")" build target ) \
      || log "WARN: target build for $t failed (task may still run if image is pullable)"
    rm -f "$cf.tmp"
  done
else
  log "BUILD_CHALLENGE_TARGETS=0 — skipping CAISI cybench target builds (authored path)"
fi

log "setup complete. Next: bash run_cybench.sh"

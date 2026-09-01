#!/usr/bin/env bash
# Cybench baseline runner — RUN THIS ON A DEDICATED x86_64 LINUX CLOUD VM.
#
# Unlike run_0a.sh (which drives a disposable Colima VM from macOS), this script runs
# EVERYTHING locally on an x86_64 Linux host, because the REAL CAISI agent image and
# the real Cybench targets are x86_64 (Kali + i386 + optional Ghidra) and cannot run
# on Apple Silicon. It builds the real agent + Cybench target images, applies a
# host-layer egress lockdown (model endpoint the only allowed destination), self-tests
# that boundary, then runs the REAL Cybench suite through promptfoo.
#
# This is BASELINE / cross-check grade: a dedicated VM + egress deny. It is NOT Gate-0B
# assurance (no microVM-per-run, broker, OOB verifier, N-attempt stats). Results are
# stamped cybench-baseline so nobody mistakes them for an assurance verdict.
#
# Provision (suggested): Ubuntu 22.04+ x86_64, 4 vCPU / 16 GB / 40 GB disk, Docker
# installed, outbound internet during provisioning (locked down before the eval).
#
# Usage (on the VM, from the repo root):
#   HALO_ENV=~/.cyber-eval.env bash plugins/cyber/skills/cyber-capability-run/deploy/run_cybench_x86.sh
#   BUILD_GAAS=1 ...   # also build the Ghidra service (needed only for rev tasks)
#   CONFIG=promptfooconfig.yaml   # default; the cybench suite (edit its tests: to add samples)
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
HALO_ENV="${HALO_ENV:-$HOME/.cyber-eval.env}"
# FULL=1 → build EVERY cybench target + GaaS and run the whole suite (auto-generates
# a config listing every discovered sample). Default runs the 3-task slice.
FULL="${FULL:-0}"
CONFIG="${CONFIG:-promptfooconfig.yaml}"          # the cybench suite (slice); FULL overrides
BUILD_GAAS="${BUILD_GAAS:-$FULL}"                 # full run needs Ghidra for the rev tasks
TIMEOUT_SECS="${TIMEOUT_SECS:-$([ "$FULL" = 1 ] && echo 28800 || echo 7200)}"  # 8h full / 2h slice

log() { printf '[cybench] %s\n' "$*"; }
fail() { printf '[cybench][BLOCKER] %s\n' "$*" >&2; exit 1; }

# --- Preflight: this MUST be an x86_64 Linux host with Docker ---
[ "$(uname -s)" = "Linux" ] || fail "run this on Linux (a dedicated x86_64 cloud VM), not $(uname -s)"
[ "$(uname -m)" = "x86_64" ] || fail "arch is $(uname -m); the real Kali agent + Cybench targets are x86_64. Provision an x86_64 VM."
command -v docker >/dev/null || fail "docker not found — install Docker on the VM"
docker info >/dev/null 2>&1 || fail "docker daemon not reachable (start Docker / add your user to the docker group)"

# --- Read the target model endpoint (never echoed) ---
[ -f "$HALO_ENV" ] || fail "creds file not found: $HALO_ENV (define AZURE_AI_BASE_URL + AZURE_AI_API_KEY)"
set -a; . "$HALO_ENV"; set +a
: "${AZURE_AI_BASE_URL:?AZURE_AI_BASE_URL missing from $HALO_ENV}"
: "${AZURE_AI_API_KEY:?AZURE_AI_API_KEY missing from $HALO_ENV}"
MODEL_BASE_URL="$AZURE_AI_BASE_URL"
read -r MODEL_HOST MODEL_PORT < <(python3 -c '
import sys, urllib.parse
u = urllib.parse.urlparse(sys.argv[1])
print(u.hostname, u.port or (443 if u.scheme=="https" else 80))
' "$MODEL_BASE_URL")
[ -n "${MODEL_HOST:-}" ] || fail "could not parse host from AZURE_AI_BASE_URL"
log "target endpoint: ${MODEL_HOST}:${MODEL_PORT} (key hidden)"

# --- Toolchain (internet ON — before lockdown) ---
if ! command -v node >/dev/null || ! command -v npm >/dev/null || ! command -v promptfoo >/dev/null; then
  log "installing base toolchain (git, python3, node, promptfoo) ..."
  sudo bash -c '
    set -e
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq git python3 python3-venv python3-pip curl ca-certificates
    command -v node >/dev/null || { curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1; apt-get install -y -qq nodejs; }
  ' || fail "base toolchain install failed"
  command -v promptfoo >/dev/null || { log "installing promptfoo (large; may take minutes) ..."; sudo npm i -g promptfoo --no-fund --no-audit --loglevel=http || fail "promptfoo install failed"; }
fi
command -v uv >/dev/null || python3 -m pip install --user -q uv || python3 -m pip install --user --break-system-packages -q uv || fail "uv install failed"
export PATH="$HOME/.local/bin:$PATH"

# Docker Compose v2 — apt's docker.io does NOT bundle it, but BOTH the cybench target
# builds AND Inspect's sandbox bring-up need `docker compose`. Install it as a CLI
# plugin (internet on, before lockdown). Without it every `docker compose` call prints
# "unknown shorthand flag: 'f'".
if ! docker compose version >/dev/null 2>&1; then
  log "installing docker compose v2 plugin ..."
  sudo mkdir -p /usr/local/lib/docker/cli-plugins
  sudo curl -fsSL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m)" \
    -o /usr/local/lib/docker/cli-plugins/docker-compose && sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose \
    || fail "docker compose plugin install failed (needed for builds + Inspect sandboxes)"
fi
docker compose version >/dev/null 2>&1 || fail "docker compose still unavailable after install"

# --- Provision the REAL harness + images (internet ON) ---
CAISI="$SKILL_DIR/scripts/vendor/caisi-cyber-evals"
if [ "$FULL" = "1" ]; then
  # FULL: let CAISI's own tool build EVERYTHING — the crude per-dir `docker compose
  # build target` loop breaks on image-only tasks, non-`target` service names, and
  # multi-image challenges. `ucb build` (no-push, default) builds core (agent + GaaS)
  # + all challenge images correctly. Some older Cybench tasks pin EOL Debian buster
  # and fail to `apt update` (upstream image rot) — those stay unbuildable and will
  # error at eval; we don't let that abort the whole run.
  log "provisioning CAISI harness (clone + uv sync; no crude target builds) ..."
  BUILD_AGENT_IMAGE=0 BUILD_CHALLENGE_TARGETS=0 HALO_ENV="$HALO_ENV" \
    bash "$SKILL_DIR/scripts/setup_caisi.sh" || fail "CAISI setup failed"
  log "building ALL images via 'ucb build' (agent + GaaS + challenges; heavy) ..."
  ( cd "$CAISI" && export PATH="$HOME/.local/bin:$PATH" && uv run ucb build ) \
    || log "WARN: 'ucb build' reported failures (rotted-base-image tasks will error at eval)"
  if [ "$BUILD_GAAS" = "1" ]; then
    log "starting Ghidra-as-a-Service on :5000 (rev tasks) ..."
    ( cd "$CAISI" && export PATH="$HOME/.local/bin:$PATH"; setsid uv run ucb gaas >"$SKILL_DIR/gaas.log" 2>&1 & ) \
      || log "WARN: could not start GaaS (rev tasks will error; give it ~30s to warm up)"
  fi
else
  # Slice: the real agent + just the 3 configured targets (fast).
  log "provisioning CAISI harness + REAL agent + the 3 slice targets (heavy) ..."
  BUILD_AGENT_IMAGE=1 BUILD_CHALLENGE_TARGETS=1 HALO_ENV="$HALO_ENV" \
    bash "$SKILL_DIR/scripts/setup_caisi.sh" || fail "CAISI setup failed"
fi

# --- FULL mode: discover every cybench sample and generate a config listing them all ---
if [ "$FULL" = "1" ]; then
  CB="$SKILL_DIR/scripts/vendor/caisi-cyber-evals/src/ucb/benchmarks/cybench"
  FULLCFG="$SKILL_DIR/scripts/promptfooconfig.cybench-full.yaml"
  # Reuse the cybench config's provider block (model/timeouts/etc.), swap in all samples.
  awk '/^tests:/{exit} {print}' "$SKILL_DIR/scripts/promptfooconfig.yaml" > "$FULLCFG"
  echo "tests:" >> "$FULLCFG"
  n=0
  for f in "$CB"/*/eval.yaml "$CB"/*/eval.yml; do
    [ -f "$f" ] || continue
    name="$(awk -F: '/^name:/{gsub(/[[:space:]"'"'"']/,"",$2); print $2; exit}' "$f")"
    [ -n "$name" ] && { printf '  - vars: { task: %s }\n' "$name" >> "$FULLCFG"; n=$((n+1)); }
  done
  [ "$n" -gt 0 ] || fail "no cybench samples found under $CB (unexpected clone/build layout)"
  log "FULL: generated $(basename "$FULLCFG") with $n samples"
  CONFIG="promptfooconfig.cybench-full.yaml"
fi

# Pre-pull the images the egress self-test needs from a container context (alpine) —
# after lockdown nothing can be pulled, so the container probe would fail with
# "could not obtain the alpine image to probe from a container".
log "pre-pulling alpine for the egress self-test (before lockdown) ..."
docker image inspect alpine:latest >/dev/null 2>&1 || docker pull alpine:latest >/dev/null 2>&1 \
  || log "WARN: alpine pull failed — the container-context self-test may fail"

# --- Pin the model host, then lock egress down to it only ---
MODEL_IP="$(getent hosts "$MODEL_HOST" | awk '{print $1; exit}')"
[ -n "${MODEL_IP:-}" ] || fail "could not resolve $MODEL_HOST"
sudo bash -c "sed -i.bak '/[[:space:]]${MODEL_HOST}\$/d' /etc/hosts 2>/dev/null; printf '%s %s\n' '${MODEL_IP}' '${MODEL_HOST}' >> /etc/hosts" \
  || log "WARN: could not pin ${MODEL_HOST} in /etc/hosts"
log "locking down egress; only ${MODEL_HOST} (${MODEL_IP}:${MODEL_PORT}) allowed ..."
sudo bash "$SCRIPT_DIR/egress-lockdown.sh" "$MODEL_IP" "$MODEL_PORT" || fail "egress lockdown failed"

# --- HARD GATE: prove the boundary before running anything ---
log "egress self-test (hard gate) ..."
bash "$SCRIPT_DIR/egress-selftest.sh" "$MODEL_IP" "$MODEL_PORT" \
  || fail "egress self-test FAILED — refusing to run"

# --- Run the REAL Cybench suite through promptfoo ---
log "running Cybench through promptfoo (config=${CONFIG}; label=cybench-baseline) ..."
cd "$SKILL_DIR/scripts" || fail "cannot cd into scripts"
export PROMPTFOO_PYTHON="$SKILL_DIR/scripts/vendor/caisi-cyber-evals/.venv/bin/python"
export OPENAI_BASE_URL="$MODEL_BASE_URL" OPENAI_API_KEY="$AZURE_AI_API_KEY"
export PROMPTFOO_DISABLE_TELEMETRY=1 PROMPTFOO_DISABLE_UPDATE=1
timeout "$TIMEOUT_SECS" promptfoo eval -c "$CONFIG" --no-cache \
  --description 'cybench-baseline (x86; gate0a-grade, not assurance)' -o "$SKILL_DIR/out.cybench.json"
rc=$?
[ "$rc" -eq 124 ] && log "WARN: run hit the ${TIMEOUT_SECS}s wall-clock guard"

log "results → $SKILL_DIR/out.cybench.json (rc=$rc)"
log "egress is still locked down. To restore: sudo iptables -P OUTPUT ACCEPT; sudo iptables -F OUTPUT"
log "This VM is yours to manage — snapshot results, then destroy the VM when done."
exit "$rc"

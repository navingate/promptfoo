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
# ─── Two-phase registry flow (how the labs run it: cache images, don't rebuild) ──────
# A cold, offline, from-scratch rebuild of every Cybench target on each run is fragile
# (some tasks pin EOL Debian and won't `apt update` anymore). The durable pattern is to
# build the images ONCE on a box with egress, push them to YOUR container registry, and
# then have each locked-down eval VM PULL the prebuilt images before lockdown. CAISI has
# no public registry (README: bring your own), so YOU populate it:
#
#   Phase 1 — PROVISION (egress ON, no lockdown, no eval): build + push cybench images.
#     docker login ghcr.io                 # or gcloud/aws registry auth — YOUR step
#     UCB_REGISTRY=ghcr.io/you/  PHASE=provision \
#       HALO_ENV=~/.cyber-eval.env bash .../deploy/run_cybench_x86.sh
#
#   Phase 2 — EVAL (this VM, locked down): pull the prebuilt images, then run.
#     docker login ghcr.io                 # so the pull can auth (before lockdown)
#     UCB_REGISTRY=ghcr.io/you/  FULL=1 \
#       HALO_ENV=~/.cyber-eval.env bash .../deploy/run_cybench_x86.sh
#
# Provision and eval can be the SAME VM (provision first, then eval) or DIFFERENT VMs
# (one builder, many disposable locked eval VMs — build once, reuse everywhere).
# Without UCB_REGISTRY the eval falls back to building locally before lockdown (the
# original behavior) — fine for one run, but rotted-base-image tasks stay unbuildable.
# NOTE: the trailing slash on UCB_REGISTRY matters (CAISI concatenates it to the tag).
#
# Usage (on the VM, from the repo root):
#   HALO_ENV=~/.cyber-eval.env bash plugins/cyber/skills/cyber-capability-run/deploy/run_cybench_x86.sh
#   FULL=1 ...              # build/pull EVERY cybench target + GaaS and run the whole suite
#   BUILD_GAAS=1 ...        # also build/start the Ghidra service (needed only for rev tasks)
#   MODEL=openai/DeepSeek-V4-Flash ...     # override the target model for THIS run (no YAML edit);
#                                          # pair it with a HALO_ENV whose AZURE_AI_BASE_URL points at
#                                          # that model's OpenAI-compatible endpoint (e.g. Azure /openai/v1)
#   PATCH_ROT=1 FULL=1 ...                 # repoint EOL-Debian task Dockerfiles at archive.debian.org
#                                          # before building, to recover apt-rot'd image tasks
#   UCB_REGISTRY=... PHASE=provision ...   # build + push images to a registry, then exit
#   UCB_REGISTRY=... FULL=1 ...            # pull prebuilt images, then run the full suite
#   CONFIG=promptfooconfig.yaml            # default; the cybench suite (edit its tests: to add samples)
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CAISI="$SKILL_DIR/scripts/vendor/caisi-cyber-evals"
HALO_ENV="${HALO_ENV:-$HOME/.cyber-eval.env}"
# FULL=1 → build/pull EVERY cybench target + GaaS and run the whole suite (auto-generates
# a config listing every discovered sample). Default runs the 3-task slice.
FULL="${FULL:-0}"
CONFIG="${CONFIG:-promptfooconfig.yaml}"          # the cybench suite (slice); FULL overrides
BUILD_GAAS="${BUILD_GAAS:-$FULL}"                 # full run needs Ghidra for the rev tasks
TIMEOUT_SECS="${TIMEOUT_SECS:-$([ "$FULL" = 1 ] && echo 28800 || echo 7200)}"  # 8h full / 2h slice
# --- Registry-backed image caching (build-once / pull-many; see the header) ---
UCB_REGISTRY="${UCB_REGISTRY:-}"                  # e.g. ghcr.io/you/  (empty = local build, no cache)
PHASE="${PHASE:-eval}"                            # 'provision' = build+push then exit; 'eval' = pull(if registry)+run
MODEL="${MODEL:-}"                                # optional Inspect model id override (e.g. openai/DeepSeek-V4-Flash); blank = the config's model
PATCH_ROT="${PATCH_ROT:-0}"                       # 1 = repoint EOL-Debian task Dockerfiles at archive.debian.org before building (recovers apt-rot images)
AGENT_IMAGE="agent-environment:1.1.1"             # keep in sync with scripts/config.env (AGENT_IMAGE)
# Registry caching only applies to the FULL suite; the 3-task slice always builds its
# handful of images locally (bare tags), so scope the effective prefix to FULL.
REG=""
if [ "$PHASE" = "provision" ] || { [ "$FULL" = "1" ] && [ -n "$UCB_REGISTRY" ]; }; then
  REG="$UCB_REGISTRY"
fi
[ -n "$UCB_REGISTRY" ] && [ "$FULL" != "1" ] && [ "$PHASE" != "provision" ] \
  && printf '[cybench] NOTE: UCB_REGISTRY is set but this is the slice (not FULL) — ignoring it; slice builds locally.\n'

log() { printf '[cybench] %s\n' "$*"; }
fail() { printf '[cybench][BLOCKER] %s\n' "$*" >&2; exit 1; }

# Restrict a `ucb build`/`ucb pull` to the CYBENCH benchmark only — the benchmarks dir
# also holds cve-bench (large) and test, which we don't want. Prints a temp dir holding
# just a symlink to cybench; caller must `rm -rf` it. Core (agent + GaaS) builds/pulls
# regardless of --benchmarks-dir.
make_cybench_bdir() {
  local d; d="$(mktemp -d)"
  ln -sfn "$CAISI/src/ucb/benchmarks/cybench" "$d/cybench"
  printf '%s' "$d"
}

# Does `ucb <subcommand>` accept <flag> in this CAISI version? Lets us adapt to CLI
# drift (e.g. whether `build` supports --push) instead of hard-coding flag shapes.
# Only call AFTER setup_caisi.sh has provisioned the venv.
ucb_has_flag() {
  ( cd "$CAISI" && export PATH="$HOME/.local/bin:$PATH" && uv run ucb "$1" --help 2>&1 | grep -q -- "$2" )
}

# --- Preflight: this MUST be an x86_64 Linux host with Docker ---
[ "$(uname -s)" = "Linux" ] || fail "run this on Linux (a dedicated x86_64 cloud VM), not $(uname -s)"
[ "$(uname -m)" = "x86_64" ] || fail "arch is $(uname -m); the real Kali agent + Cybench targets are x86_64. Provision an x86_64 VM."
command -v docker >/dev/null || fail "docker not found — install Docker on the VM"
docker info >/dev/null 2>&1 || fail "docker daemon not reachable (start Docker / add your user to the docker group)"

case "$PHASE" in eval|provision) ;; *) fail "PHASE must be 'eval' or 'provision', not '$PHASE'";; esac
if [ "$PHASE" = "provision" ]; then
  [ -n "$UCB_REGISTRY" ] || fail "PHASE=provision needs UCB_REGISTRY (e.g. UCB_REGISTRY=ghcr.io/you/) — nothing to push to otherwise"
fi

# --- Read the target model endpoint (never echoed) ---
# Both phases read it: eval uses it to lock egress + run; provision only needs the creds
# file present so setup_caisi.sh can populate the harness .env (it is NOT used to build).
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
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  log "installing base toolchain (git, python3, node) ..."
  sudo bash -c '
    set -e
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq git python3 python3-venv python3-pip curl ca-certificates
    command -v node >/dev/null || { curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1; apt-get install -y -qq nodejs; }
  ' || fail "base toolchain install failed"
fi
command -v uv >/dev/null || python3 -m pip install --user -q uv || python3 -m pip install --user --break-system-packages -q uv || fail "uv install failed"
export PATH="$HOME/.local/bin:$PATH"
# promptfoo is only needed to RUN the eval — skip its (large) install on a pure builder.
if [ "$PHASE" = "eval" ] && ! command -v promptfoo >/dev/null; then
  log "installing promptfoo (large; may take minutes) ..."
  sudo npm i -g promptfoo --no-fund --no-audit --loglevel=http || fail "promptfoo install failed"
fi

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

# ─── PHASE 1: PROVISION — build + push cybench images to the registry, then exit ─────
# Egress stays ON (we must reach the registry). No lockdown, no eval. Run this on any
# egress-open box (the eval VM itself before lockdown, or a separate builder).
if [ "$PHASE" = "provision" ]; then
  log "PROVISION: build + push cybench images to ${UCB_REGISTRY}"
  log "NOTE: ensure you have authenticated to the registry first — e.g. 'docker login ${UCB_REGISTRY%%/*}'"
  log "      (or 'gcloud auth configure-docker' / 'aws ecr get-login-password | docker login ...'); push fails with an auth error otherwise."
  log "provisioning CAISI harness (clone + uv sync; no local target builds) ..."
  BUILD_AGENT_IMAGE=0 BUILD_CHALLENGE_TARGETS=0 UCB_CONTAINER_REGISTRY="$REG" HALO_ENV="$HALO_ENV" \
    bash "$SKILL_DIR/scripts/setup_caisi.sh" || fail "CAISI setup failed"
  [ "$PATCH_ROT" = "1" ] && { log "PATCH_ROT=1: repointing EOL-Debian task Dockerfiles at archive.debian.org ..."; bash "$SKILL_DIR/scripts/patch_rot.sh" || log "WARN: patch_rot.sh reported an error"; }
  BDIR="$(make_cybench_bdir)"
  PUSH=""
  if ucb_has_flag build --push; then
    PUSH="--push"
  else
    log "WARN: this CAISI 'ucb build' has no --push flag — images will build locally only (no registry push). Update the CAISI clone or push manually."
  fi
  log "building agent + GaaS + all CYBENCH challenge images and pushing to ${UCB_REGISTRY} (heavy) ..."
  # --benchmarks-dir is a TOP-LEVEL flag (usage: `ucb [--benchmarks-dir X] {build,pull,...}`),
  # so it MUST come before the subcommand; --push is a build-subcommand option (after `build`).
  ( cd "$CAISI" && export PATH="$HOME/.local/bin:$PATH" UCB_CONTAINER_REGISTRY="$REG" && uv run ucb --benchmarks-dir "$BDIR" build $PUSH ) \
    || log "WARN: 'ucb build --push' reported failures (rotted-base-image tasks won't build/push; the rest still cached)"
  rm -rf "$BDIR"
  log "PROVISION done. On the (locked) eval VM run:"
  log "    docker login ${UCB_REGISTRY%%/*}   # so the pull can auth, before lockdown"
  log "    UCB_REGISTRY=${UCB_REGISTRY} FULL=1 HALO_ENV=${HALO_ENV} bash ${BASH_SOURCE[0]}"
  exit 0
fi

# ─── PHASE 2: EVAL — provision/pull images, lock egress, run the suite ───────────────

# --- Provision the REAL harness + images (internet ON) ---
if [ "$FULL" = "1" ]; then
  # FULL: let CAISI's own tool build/pull EVERYTHING — the crude per-dir `docker compose
  # build target` loop breaks on image-only tasks, non-`target` service names, and
  # multi-image challenges. `ucb build` (no-push) builds core (agent + GaaS) + all
  # challenge images correctly; `ucb pull` fetches prebuilt ones from the registry.
  # Some older Cybench tasks pin EOL Debian buster and fail to `apt update` (upstream
  # image rot) — those stay unbuildable and will error at eval; we don't abort the run.
  log "provisioning CAISI harness (clone + uv sync) ..."
  BUILD_AGENT_IMAGE=0 BUILD_CHALLENGE_TARGETS=0 UCB_CONTAINER_REGISTRY="$REG" HALO_ENV="$HALO_ENV" \
    bash "$SKILL_DIR/scripts/setup_caisi.sh" || fail "CAISI setup failed"
  BDIR="$(make_cybench_bdir)"
  if [ -n "$REG" ]; then
    # Registry path: PULL prebuilt images (egress still ON, before lockdown) instead of
    # rebuilding from scratch. Matches how the labs run it — build once, reuse.
    log "pulling prebuilt cybench images from ${REG} (before lockdown) ..."
    log "NOTE: 'docker login ${REG%%/*}' must have succeeded for a private registry, or the pull fails with an auth error."
    # --benchmarks-dir is a TOP-LEVEL flag and must precede the subcommand.
    ( cd "$CAISI" && export PATH="$HOME/.local/bin:$PATH" UCB_CONTAINER_REGISTRY="$REG" && uv run ucb --benchmarks-dir "$BDIR" pull ) \
      || log "WARN: 'ucb pull' reported failures (some tasks may lack images and will error at eval)"
    # Sanity gate: if NOTHING from the registry landed, the pull did not work — refuse to
    # lock down and waste hours on a doomed run. Match by registry HOST (robust to any
    # path/tag differences in how CAISI names the images).
    if ! docker images --format '{{.Repository}}' | grep -Fq "${REG%%/*}"; then
      fail "no images from ${REG%%/*} present after 'ucb pull' — run PHASE=provision first (and 'docker login ${REG%%/*}'). Refusing to lock down."
    fi
    # `ucb pull` may fetch only challenge images, not the core agent. If the agent image
    # is absent, build it locally now (egress still on) so sandboxes can start. This is
    # the same direct build setup_caisi.sh uses; tag it BOTH prefixed (what the eval-time
    # compose looks up) and bare.
    if ! docker image inspect "${REG}${AGENT_IMAGE}" >/dev/null 2>&1 && ! docker image inspect "$AGENT_IMAGE" >/dev/null 2>&1; then
      log "agent image absent after pull — building it locally (egress still on) ..."
      docker build -t "${REG}${AGENT_IMAGE}" -t "$AGENT_IMAGE" \
        -f "$CAISI/src/ucb/containers/agent/Dockerfile" "$CAISI/src/ucb/containers/agent" \
        || log "WARN: agent image build failed — cybench sandboxes may not start"
    fi
  else
    # No registry: build all cybench images locally (the original from-scratch path).
    [ "$PATCH_ROT" = "1" ] && { log "PATCH_ROT=1: repointing EOL-Debian task Dockerfiles at archive.debian.org ..."; bash "$SKILL_DIR/scripts/patch_rot.sh" || log "WARN: patch_rot.sh reported an error"; }
    log "building agent + GaaS + all CYBENCH challenge images via 'ucb build' (heavy) ..."
    # --benchmarks-dir is a TOP-LEVEL flag and must precede the subcommand.
    ( cd "$CAISI" && export PATH="$HOME/.local/bin:$PATH" && uv run ucb --benchmarks-dir "$BDIR" build ) \
      || log "WARN: 'ucb build' reported failures (rotted-base-image tasks will error at eval)"
  fi
  rm -rf "$BDIR"
  if [ "$BUILD_GAAS" = "1" ]; then
    log "starting Ghidra-as-a-Service on :5000 (rev tasks) ..."
    ( cd "$CAISI" && export PATH="$HOME/.local/bin:$PATH" UCB_CONTAINER_REGISTRY="$REG"; setsid uv run ucb gaas >"$SKILL_DIR/gaas.log" 2>&1 & ) \
      || log "WARN: could not start GaaS (rev tasks will error; give it ~30s to warm up)"
  fi
else
  # Slice: the real agent + just the 3 configured targets (fast). Always local, bare tags.
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

# Optional target-model override (MODEL=openai/...): rewrite ONLY the provider `model:`
# line in the config we're about to run, into a throwaway promptfooconfig.run.yaml — so
# you can retarget (e.g. the local Qwen vs an Azure DeepSeek endpoint) without editing
# the committed default. Uniform for slice and full: it operates on whatever CONFIG is.
# The matching endpoint/key still come from HALO_ENV (AZURE_AI_BASE_URL/AZURE_AI_API_KEY).
if [ -n "$MODEL" ]; then
  RUNCFG="$SKILL_DIR/scripts/promptfooconfig.run.yaml"
  sed -E "s|^([[:space:]]*)model:[[:space:]].*|\1model: ${MODEL}|" \
    "$SKILL_DIR/scripts/$CONFIG" > "$RUNCFG" || fail "could not apply MODEL override"
  grep -qE "^[[:space:]]*model:[[:space:]]*${MODEL}$" "$RUNCFG" \
    || fail "MODEL override did not take (no provider model: line in $CONFIG?)"
  CONFIG="promptfooconfig.run.yaml"
  log "MODEL override → ${MODEL} (running $(basename "$RUNCFG"))"
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
# Make the eval-time compose resolve the SAME registry-prefixed tags `ucb pull` fetched
# (provider.py copies this process env into the Inspect subprocess). Empty for the local
# path — bare tags — which is exactly what a local `ucb build`/slice produced.
export UCB_CONTAINER_REGISTRY="$REG"
export PROMPTFOO_DISABLE_TELEMETRY=1 PROMPTFOO_DISABLE_UPDATE=1
timeout "$TIMEOUT_SECS" promptfoo eval -c "$CONFIG" --no-cache \
  --description 'cybench-baseline (x86; gate0a-grade, not assurance)' -o "$SKILL_DIR/out.cybench.json"
rc=$?
[ "$rc" -eq 124 ] && log "WARN: run hit the ${TIMEOUT_SECS}s wall-clock guard"

log "results → $SKILL_DIR/out.cybench.json (rc=$rc)"
log "egress is still locked down. To restore: sudo iptables -P OUTPUT ACCEPT; sudo iptables -F OUTPUT"
log "This VM is yours to manage — snapshot results, then destroy the VM when done."
exit "$rc"

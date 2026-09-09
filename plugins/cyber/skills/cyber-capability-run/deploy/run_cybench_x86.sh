#!/usr/bin/env bash
# Cybench baseline runner — RUN THIS ON A DEDICATED x86_64 LINUX CLOUD VM.
#
# This script runs EVERYTHING locally on an x86_64 Linux host, because the REAL CAISI agent image and
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
#       bash .../deploy/run_cybench_x86.sh          # creds from the repo-root .env
#
#   Phase 2 — EVAL (this VM, locked down): pull the prebuilt images, then run.
#     docker login ghcr.io                 # so the pull can auth (before lockdown)
#     UCB_REGISTRY=ghcr.io/you/  FULL=1 \
#       bash .../deploy/run_cybench_x86.sh          # creds from the repo-root .env
#
# Provision and eval can be the SAME VM (provision first, then eval) or DIFFERENT VMs
# (one builder, many disposable locked eval VMs — build once, reuse everywhere).
# Without UCB_REGISTRY the eval falls back to building locally before lockdown (the
# original behavior) — fine for one run, but rotted-base-image tasks stay unbuildable.
# NOTE: the trailing slash on UCB_REGISTRY matters (CAISI concatenates it to the tag).
#
# Usage (on the VM, from the repo root):
#   bash plugins/cyber/skills/cyber-capability-run/deploy/run_cybench_x86.sh   # creds from the repo-root .env
#   FULL=1 ...              # build/pull EVERY cybench target + GaaS and run the whole suite
#   BUILD_GAAS=1 ...        # also build/start the Ghidra service (needed only for rev tasks)
#   CYBER_SUT_ENDPOINT=engy CYBER_MODEL=openai/glm-5.3 ...   # PREFERRED: pick a registered endpoint
#                                          # (engy/chutes/azure/openai) from provider.py's SUT_ENDPOINTS —
#                                          # same interface as F2 offense/defense. base_url + key + the egress
#                                          # lockdown all resolve from the registry; needs that endpoint's key
#                                          # (e.g. ENGY_API_KEY) in the repo-root .env. anthropic/local are
#                                          # rejected here (no host to pin) — use scripts/run_cybench.sh.
#   MODEL=openai/DeepSeek-V4-Flash ...     # override the target model for THIS run (no YAML edit; CYBER_MODEL
#                                          # is the alias). Endpoint unset → legacy AZURE_AI_BASE_URL/
#                                          # AZURE_AI_API_KEY from the repo-root .env (or pass those inline).
#   PATCH_ROT=1 FULL=1 ...                 # repoint EOL-Debian task Dockerfiles at archive.debian.org
#                                          # before building, to recover apt-rot'd image tasks
#   UCB_REGISTRY=... PHASE=provision ...   # build + push images to a registry, then exit
#   UCB_REGISTRY=... FULL=1 ...            # pull prebuilt images, then run the full suite
#   CONFIG=promptfooconfig.yaml            # default; the cybench suite (edit its tests: to add samples)
#   SUITE=authored ...                     # run the Hybrid AD -> Cloud Takeover offense chain (../tasks) instead of
#                                          # cybench: pre-builds the authored target images, uses
#                                          # promptfooconfig.f2.yaml (override with CONFIG=...)
#   RUNS=3 RUN_TAG=qwen-cybench ...        # Pass@k: repeat the eval 3x into out.<tag>.run{1,2,3}.json,
#                                          # then aggregate with scripts/aggregate_runs.cjs
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CAISI="$SKILL_DIR/scripts/vendor/caisi-cyber-evals"
# Credentials come from the consolidated repo-root .env (single source — no separate creds file).
REPO_ROOT="$(cd "$SKILL_DIR/../../../.." && pwd)"
HALO_ENV="${HALO_ENV:-$REPO_ROOT/.env}"
# SUITE selects WHAT to run: 'cybench' (CAISI's public CTF suite; default), 'cvebench'
# (CAISI's CVE-Bench real web-exploitation suite, via benchmark: cvebench — the agent must
# EXPLOIT a live vulnerable app; an evaluator service confirms the impact), or 'authored'
# (the Hybrid AD -> Cloud Takeover offense chain under ../tasks, via benchmark: authored).
SUITE="${SUITE:-cybench}"
# FULL=1 → build/pull EVERY cybench target + GaaS and run the whole suite (auto-generates
# a config listing every discovered sample). Default runs the 3-task slice. (cybench only)
FULL="${FULL:-0}"
# Config default depends on the suite: cybench → the 3-task slice (FULL overrides with the
# generated full config); authored → the Hybrid AD → Cloud Takeover offense chain (task id F2,
# pfcyber-f2-adcloud — the only authored task kept after the plugin was pruned to its keepers).
if [ "$SUITE" = "authored" ]; then
  CONFIG="${CONFIG:-promptfooconfig.f2.yaml}"
elif [ "$SUITE" = "cvebench" ]; then
  CONFIG="${CONFIG:-promptfooconfig.cve-bench.yaml}"
else
  CONFIG="${CONFIG:-promptfooconfig.yaml}"
fi
BUILD_GAAS="${BUILD_GAAS:-$([ "$SUITE" = cybench ] && echo "$FULL" || echo 0)}"  # Ghidra: cybench-full only
TIMEOUT_SECS="${TIMEOUT_SECS:-$([ "$FULL" = 1 ] || [ "$SUITE" = authored ] || [ "$SUITE" = cvebench ] && echo 28800 || echo 7200)}"  # 8h full/authored/cvebench / 2h slice
# --- Registry-backed image caching (build-once / pull-many; see the header) ---
UCB_REGISTRY="${UCB_REGISTRY:-}"                  # e.g. ghcr.io/you/  (empty = local build, no cache)
PHASE="${PHASE:-eval}"                            # 'provision' = build+push then exit; 'eval' = pull(if registry)+run
MODEL="${MODEL:-${CYBER_MODEL:-}}"                # optional Inspect model id override (MODEL= or the uniform CYBER_MODEL=, e.g. openai/glm-5.3); blank = the config's model
PATCH_ROT="${PATCH_ROT:-0}"                       # 1 = repoint EOL-Debian task Dockerfiles at archive.debian.org before building (recovers apt-rot images)
# --- Pass@k: repeat the eval to average out run-to-run variance ---
RUNS="${RUNS:-1}"                                 # >1 = run the eval N times into per-run JSONs, then aggregate
RUN_TAG="${RUN_TAG:-$SUITE}"                      # label for per-run output files (set e.g. qwen-cybench / deepseek-authored)
CANON="$SKILL_DIR/out.${SUITE}.json"             # canonical latest-run output (out.cybench.json / out.authored.json)
AGENT_IMAGE="agent-environment:1.1.1"             # keep in sync with scripts/config.env (AGENT_IMAGE)
# Registry caching only applies to the FULL suite; the 3-task slice always builds its
# handful of images locally (bare tags), so scope the effective prefix to FULL.
REG=""
if [ "$SUITE" = "cybench" ] && { [ "$PHASE" = "provision" ] || { [ "$FULL" = "1" ] && [ -n "$UCB_REGISTRY" ]; }; }; then
  REG="$UCB_REGISTRY"
fi
[ -n "$UCB_REGISTRY" ] && [ "$FULL" != "1" ] && [ "$PHASE" != "provision" ] \
  && printf '[cybench] NOTE: UCB_REGISTRY is set but this is the slice (not FULL) — ignoring it; slice builds locally.\n'

log() { printf '[cybench] %s\n' "$*"; }
fail() { printf '[cybench][BLOCKER] %s\n' "$*" >&2; exit 1; }

# Restrict a `ucb build`/`ucb pull` to the CYBENCH benchmark only — the benchmarks dir
# also holds cve-bench (large) and test, which we don't want. Prints a temp dir holding
# just a symlink to cybench; caller must `rm -rf` it.
#
# CRITICAL: the temp dir MUST live under src/ucb/ (a sibling of the real containers/),
# NOT in /tmp. `ucb build` resolves the core agent/gaas build contexts as
# <benchmarks-dir>/../containers — so a /tmp benchmarks-dir makes it look for
# /tmp/containers/agent, which doesn't exist, and the core build dies with
# "unable to prepare context: path /tmp/containers/agent not found" (taking the whole
# build, including the challenge images, down with it). Placing the dir under src/ucb/
# keeps ../containers pointing at the real src/ucb/containers.
make_cybench_bdir() {
  local d; d="$(mktemp -d "$CAISI/src/ucb/pf-cybench.XXXXXX")"
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
# present so setup_caisi.sh can populate the harness .env (it is NOT used to build).
#
# Endpoint resolution — uniform with F2 offense/defense and the arm64 run_cybench.sh:
#   CYBER_SUT_ENDPOINT=<name>  → resolve base_url + key from the shared SUT_ENDPOINTS registry
#     (scripts/provider.py, the single source of truth) via `provider.py --resolve-endpoint`.
#     Keys the registry references (ENGY_API_KEY, CHUTES_API_KEY, …) come from the repo-root .env.
#   unset                      → legacy: AZURE_AI_BASE_URL/AZURE_AI_API_KEY (inline or repo-root .env).
# The resolved base_url drives BOTH the model call AND the egress lockdown (its host is pinned as the
# ONLY allowed destination below), so an endpoint with no base_url (anthropic/local) is REJECTED on
# this locked path — use scripts/run_cybench.sh for those, or pass AZURE_AI_BASE_URL for a one-off.
if [ -n "${CYBER_SUT_ENDPOINT:-}" ]; then
  # Resolve via the single-source registry. Capture FIRST so the resolver's non-zero exit is caught:
  # `eval "$(cmd)" || fail` does NOT catch cmd's failure (its status is discarded as an arg to eval).
  _sut_env="$(python3 "$SKILL_DIR/scripts/provider.py" --resolve-endpoint "$CYBER_SUT_ENDPOINT")" \
    || fail "unknown CYBER_SUT_ENDPOINT '$CYBER_SUT_ENDPOINT' (see scripts/provider.py SUT_ENDPOINTS)"
  # Only eval output that matches the resolver contract — never stale/garbage output (e.g. an older
  # provider.py without --resolve-endpoint), which would otherwise mis-resolve the egress-locked endpoint.
  case "$_sut_env" in PFCYBER_SUT_*) : ;; *) fail "provider.py --resolve-endpoint gave unexpected output — is it present and up to date?" ;; esac
  eval "$_sut_env"; unset _sut_env
  [ -n "${PFCYBER_SUT_BASE_URL:-}" ] \
    || fail "endpoint '$CYBER_SUT_ENDPOINT' has no base_url (anthropic/local) — the egress-locked x86 runner needs a host to pin; use scripts/run_cybench.sh, or set AZURE_AI_BASE_URL for a one-off"
  MODEL_BASE_URL="$PFCYBER_SUT_BASE_URL"
  _ke="${PFCYBER_SUT_KEY_ENV:-}"
  # Pull the key from the repo-root .env ONLY if it is not already in the env — so an inline key
  # wins and an empty .env placeholder can't clobber it.
  if [ -n "$_ke" ] && [ -z "$(printenv "$_ke" || true)" ] && [ -f "$HALO_ENV" ]; then
    set -a; . "$HALO_ENV"; set +a
  fi
  MODEL_API_KEY="$(printenv "$_ke" 2>/dev/null || true)"
  [ -n "$MODEL_API_KEY" ] || fail "endpoint '$CYBER_SUT_ENDPOINT' needs \$${_ke:-<api_key_env>} in the env (inline or in $HALO_ENV)"
  unset _ke
  log "endpoint from SUT_ENDPOINTS registry: $CYBER_SUT_ENDPOINT"
  # setup_caisi.sh reads the model endpoint from $HALO_ENV as AZURE_AI_* (mapping them to OPENAI_* in the
  # harness .env) and hard-requires them. On the registry path the repo .env need not carry AZURE_AI_*, so
  # hand setup_caisi.sh a private temp creds file with the RESOLVED endpoint and repoint HALO_ENV at it
  # (every setup_caisi.sh call site forwards "$HALO_ENV"). Mirrors run_0a.sh's vm.env carrier.
  _caisi_creds="$(mktemp "${TMPDIR:-/tmp}/pfcyber-caisi-creds.XXXXXX")" || fail "could not create temp creds file"
  chmod 600 "$_caisi_creds"
  trap 'rm -f "$_caisi_creds"' EXIT
  { printf 'AZURE_AI_BASE_URL=%s\n' "$MODEL_BASE_URL"; printf 'AZURE_AI_API_KEY=%s\n' "$MODEL_API_KEY"; } > "$_caisi_creds"
  HALO_ENV="$_caisi_creds"
else
  # Legacy: inline AZURE_AI_BASE_URL/AZURE_AI_API_KEY win; otherwise pull from the repo-root .env ($HALO_ENV).
  if [ -z "${AZURE_AI_BASE_URL:-}" ] || [ -z "${AZURE_AI_API_KEY:-}" ]; then
    [ -f "$HALO_ENV" ] || fail "creds not found: add AZURE_AI_BASE_URL + AZURE_AI_API_KEY to $HALO_ENV, pass them inline, or use CYBER_SUT_ENDPOINT=<name>"
    set -a; . "$HALO_ENV"; set +a
  fi
  : "${AZURE_AI_BASE_URL:?AZURE_AI_BASE_URL missing (add it to $HALO_ENV or pass inline)}"
  : "${AZURE_AI_API_KEY:?AZURE_AI_API_KEY missing (add it to $HALO_ENV or pass inline)}"
  MODEL_BASE_URL="$AZURE_AI_BASE_URL"
  MODEL_API_KEY="$AZURE_AI_API_KEY"
fi
read -r MODEL_HOST MODEL_PORT < <(python3 -c '
import sys, urllib.parse
u = urllib.parse.urlparse(sys.argv[1])
print(u.hostname, u.port or (443 if u.scheme=="https" else 80))
' "$MODEL_BASE_URL")
[ -n "${MODEL_HOST:-}" ] || fail "could not parse host from the resolved model base URL"
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
  [ "$SUITE" = "cvebench" ] && fail "PHASE=provision is not supported for cvebench yet — use PHASE=eval (builds the cve-bench target+evaluator images locally)"
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
  ( cd "$CAISI" && export PATH="$HOME/.local/bin:$PATH" UCB_CONTAINER_REGISTRY="$REG" && uv run ucb --benchmarks-dir "$BDIR" build --no-multithread $PUSH ) \
    || log "WARN: 'ucb build --push' reported failures (rotted-base-image tasks won't build/push; the rest still cached)"
  rm -rf "$BDIR"
  log "PROVISION done. On the (locked) eval VM run:"
  log "    docker login ${UCB_REGISTRY%%/*}   # so the pull can auth, before lockdown"
  log "    UCB_REGISTRY=${UCB_REGISTRY} FULL=1 HALO_ENV=${HALO_ENV} bash ${BASH_SOURCE[0]}"
  exit 0
fi

# ─── PHASE 2: EVAL — provision/pull images, lock egress, run the suite ───────────────

# The build/pull phase needs the internet — to pull base images and (for PATCH_ROT) to
# reach archive.debian.org. A prior run (or a killed one) may have left the egress
# lockdown in place, which silently breaks builds: base-image pulls time out on blocked
# DNS, and in-build `apt` (container egress) is dropped by DOCKER-USER. Clear BOTH
# chains now; we re-apply the lockdown + self-test before the eval, so containment is
# unchanged for the run itself.
log "opening egress for the build/pull phase (a prior run may have left it locked) ..."
sudo iptables -P OUTPUT ACCEPT 2>/dev/null || true
sudo iptables -F OUTPUT 2>/dev/null || true
sudo iptables -F DOCKER-USER 2>/dev/null || true

# --- Provision the REAL harness + images (internet ON) ---
if [ "$SUITE" = "authored" ]; then
  # Authored/enterprise suite (../tasks via benchmark: authored). Provision the harness +
  # agent, then PRE-BUILD every authored task's target image (egress on) so eval-time
  # `docker compose up` finds them present under lockdown. Each task compose references the
  # agent as an image (no build stanza), so `docker compose build` builds only the target
  # service(s) — no shared-agent re-tag race, so multithread is fine here.
  log "provisioning CAISI harness + agent for the authored suite ..."
  BUILD_AGENT_IMAGE=1 BUILD_CHALLENGE_TARGETS=0 HALO_ENV="$HALO_ENV" \
    bash "$SKILL_DIR/scripts/setup_caisi.sh" || fail "CAISI setup failed"
  [ "$PATCH_ROT" = "1" ] && { log "PATCH_ROT=1: repointing EOL-Debian authored Dockerfiles at archive.debian.org ..."; bash "$SKILL_DIR/scripts/patch_rot.sh" "$SKILL_DIR/tasks" || log "WARN: patch_rot.sh reported an error"; }
  log "pre-building authored task target images (egress on; heavy) ..."
  a_built=0; a_failed=0
  for c in "$SKILL_DIR"/tasks/*/compose.yml; do
    [ -f "$c" ] || continue
    d="$(dirname "$c")"
    if ( cd "$d" && docker compose build >/dev/null 2>&1 ); then
      a_built=$((a_built + 1))
    else
      a_failed=$((a_failed + 1)); log "WARN: authored target build failed for $(basename "$d")"
    fi
  done
  log "authored pre-build done — ${a_built} built, ${a_failed} failed (failed tasks will error at eval)."
elif [ "$SUITE" = "cvebench" ]; then
  # CVE-Bench: real vulnerable web apps + a per-task evaluator service (scoring is
  # evaluator-poll via ucb/cvebench_agent, not flags). Web exploitation only → no
  # Ghidra/GaaS. Provision the harness + REAL agent, then pre-build each cve-bench
  # task's images (target + evaluator) so eval-time `docker compose up` finds them
  # present under egress lockdown. Local, bare tags (no registry) — same as the slice.
  log "provisioning CAISI harness + agent for the cve-bench suite ..."
  BUILD_AGENT_IMAGE=1 BUILD_CHALLENGE_TARGETS=0 HALO_ENV="$HALO_ENV" \
    bash "$SKILL_DIR/scripts/setup_caisi.sh" || fail "CAISI setup failed"
  CVEBENCH_DIR="$CAISI/src/ucb/benchmarks/cve-bench"
  [ -d "$CVEBENCH_DIR" ] || fail "cve-bench dir not found at $CVEBENCH_DIR (unexpected clone layout)"
  # Overlay promptfoo-OWNED ported cve-bench tasks into the (gitignored, re-cloned) clone.
  # These committed task dirs are the durable home for the CVEs beyond upstream CAISI's 8
  # (build-your-own — see cve-bench-tasks/README.md). Copy adds/overwrites, and runs BEFORE
  # the patch-recipe + build so overlaid tasks are patched + built like the upstream ones.
  OVERLAY="$SKILL_DIR/cve-bench-tasks"
  if [ -d "$OVERLAY" ]; then
    n_over=$(find "$OVERLAY" -maxdepth 1 -type d -name 'CVE-*' 2>/dev/null | wc -l | tr -d ' ')
    log "overlaying ${n_over} promptfoo-owned cve-bench task(s) into the clone ..."
    cp -a "$OVERLAY"/CVE-* "$CVEBENCH_DIR"/ 2>/dev/null || true
  fi
  # Curated cve-bench build-recipe — ALWAYS ON (reliability layer; scoped + idempotent; 3
  # named build-rot fixes). CVEBENCH_NO_PATCH=1 = pristine upstream (reproducibility / CI rot-detection).
  [ "${CVEBENCH_NO_PATCH:-0}" = "1" ] || { log "cve-bench build-recipe patches (CVEBENCH_NO_PATCH=1 to skip) ..."; bash "$SKILL_DIR/scripts/patch_rot_cvebench.sh" "$CVEBENCH_DIR" || log "WARN: patch_rot_cvebench.sh — genuine patch failure"; }
  # Generic EOL-Debian distro-string scan — OPT-IN (broad blast radius); for future porting.
  [ "$PATCH_ROT" = "1" ] && { log "PATCH_ROT=1: generic EOL-Debian scan of cve-bench ..."; bash "$SKILL_DIR/scripts/patch_rot.sh" "$CVEBENCH_DIR" || log "WARN: patch_rot.sh reported an error"; }
  log "pre-building cve-bench task images (target + evaluator; egress on; heavy) ..."
  c_built=0; c_failed=0; c_premiss=0
  for c in "$CVEBENCH_DIR"/*/compose.yml "$CVEBENCH_DIR"/*/compose.yaml; do
    [ -f "$c" ] || continue
    d="$(dirname "$c")"; tname="$(basename "$d")"
    # CAISI composes carry explicit `image:` tags with the build stanza commented (so
    # eval-time `up` uses the prebuilt image). Uncomment build into a temp compose so
    # `docker compose build` builds AND tags each service (target + evaluator) with that
    # exact image: name — eval-time `up` then finds it locally under lockdown and never
    # rebuilds (a rebuild under lockdown would fail: base-image pulls hit blocked docker.io).
    ctmp="$d/compose.pfbuild.tmp.yml"
    sed 's/ #context:/ context:/; s/ #build:/ build:/' "$c" > "$ctmp"
    blog="$SKILL_DIR/cvebench-build-${tname}.log"   # per-task build log — captures the WHY on failure
    if ( cd "$d" && UCB_CONTAINER_REGISTRY= docker compose -f "$(basename "$ctmp")" build >"$blog" 2>&1 ); then
      c_built=$((c_built + 1))
    else
      c_failed=$((c_failed + 1)); log "WARN: cve-bench image build failed for ${tname} — see $(basename "$blog")"; tail -4 "$blog" | sed 's/^/      /'
    fi
    # Cache EXTERNAL image-only deps (e.g. mysql:8.0 in CVE-2024-5084) NOW, egress-on —
    # else eval-time `up` pulls them from docker.io under lockdown and errors. Pull the
    # image: refs WITHOUT the ${UCB_CONTAINER_REGISTRY} prefix; the prefixed ones are the
    # task's own just-built images + the agent (local-only, so `compose pull` chokes on
    # them and never reaches the external dep — the bug this replaces).
    for img in $(grep -hE '^[[:space:]]*image:' "$c" | sed -E 's/^[[:space:]]*image:[[:space:]]*//' | grep -v 'UCB_CONTAINER_REGISTRY' | tr -d '"'); do
      docker pull "$img" >/dev/null 2>&1 && log "  cached dep image $img" || log "  WARN: could not pre-pull dep image $img"
    done
    # POST-CHECK (fail-loud): every image the eval-time compose needs MUST be present now,
    # or it becomes a SILENT harness_error under lockdown on a scored run. Resolve
    # ${UCB_CONTAINER_REGISTRY} -> empty (local bare tags) and inspect each image: ref.
    miss=""
    for img in $(grep -hE '^[[:space:]]*image:' "$c" | sed -E 's/^[[:space:]]*image:[[:space:]]*//; s/\$\{UCB_CONTAINER_REGISTRY[^}]*\}//' | tr -d '"'); do
      docker image inspect "$img" >/dev/null 2>&1 || miss="$miss $img"
    done
    [ -n "$miss" ] && { c_premiss=$((c_premiss + 1)); log "PREFLIGHT-MISS: ${tname} missing image(s):${miss} — WILL error at eval (not a scored result); fix build/pull first."; }
    rm -f "$ctmp"
  done
  log "cve-bench pre-build done — ${c_built} built, ${c_failed} failed (failed tasks will error at eval)."
  [ "$c_premiss" -gt 0 ] && log "PREFLIGHT: ${c_premiss} task(s) have MISSING images and will error if run — see PREFLIGHT-MISS lines above."
elif [ "$FULL" = "1" ]; then
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
    # --benchmarks-dir is a TOP-LEVEL flag and must precede the subcommand. --no-multithread
    # serializes the builds: `ucb build` is parallel by default, and every task's compose
    # re-tags the SHARED agent-environment image, so parallel builds race on Docker's
    # containerd image store ("failed to create image ... AlreadyExists"). Serial is slower
    # but clean and deterministic.
    ( cd "$CAISI" && export PATH="$HOME/.local/bin:$PATH" && uv run ucb --benchmarks-dir "$BDIR" build --no-multithread ) \
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

# --- FULL mode (cybench only): discover every cybench sample and generate a config listing them ---
if [ "$SUITE" = "cybench" ] && [ "$FULL" = "1" ]; then
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
# The matching endpoint/key come from the resolved endpoint above (CYBER_SUT_ENDPOINT=<name> via the
# SUT_ENDPOINTS registry, or the legacy AZURE_AI_* creds) — MODEL/CYBER_MODEL rewrites only the model NAME.
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
# Resolve to IPv4 ONLY: the egress lockdown is IPv4 (iptables) and drops IPv6 wholesale, but a
# dual-stack / Cloudflare-fronted endpoint (e.g. engy → api.engy.ai) has both A and AAAA records.
# `getent hosts` returns the IPv6 first and `getent ahostsv4` returns nothing under systemd-resolved's
# nss-resolve on some hosts — both break the IPv4 lockdown. Prefer Python getaddrinfo(AF_INET), then
# fall back to getent-filtered-to-IPv4 and dig, so any host with an A record yields its IPv4.
# Scrub any stale pin for this host from a prior (possibly failed) run BEFORE resolving. A leftover
# /etc/hosts line — e.g. an IPv6 left by a run that died at the iptables step — poisons resolution: nss
# 'files' finds the host with no IPv4 and does NOT fall through to DNS → gaierror "No address associated
# with hostname". Scrubbing first makes resolution query DNS fresh; the pin below re-adds the IPv4.
sudo sed -i.bak "/[[:space:]]${MODEL_HOST}\$/d" /etc/hosts 2>/dev/null \
  || log "WARN: could not scrub a stale ${MODEL_HOST} pin from /etc/hosts (need sudo?) — resolution may fail if one is present"
MODEL_IP="$(python3 -c 'import socket,sys;print(socket.getaddrinfo(sys.argv[1],None,socket.AF_INET,socket.SOCK_STREAM)[0][4][0])' "$MODEL_HOST" 2>/dev/null)"
[ -n "$MODEL_IP" ] || MODEL_IP="$(getent hosts "$MODEL_HOST" | awk '$1 ~ /^[0-9]+\./ {print $1; exit}')"
[ -n "$MODEL_IP" ] || { command -v dig >/dev/null 2>&1 && MODEL_IP="$(dig +short A "$MODEL_HOST" | grep -m1 -E '^[0-9]+\.')"; }
[ -n "${MODEL_IP:-}" ] || fail "could not resolve $MODEL_HOST to an IPv4 address (egress lockdown is IPv4-only; an IPv6-only endpoint is unsupported)"
sudo bash -c "sed -i.bak '/[[:space:]]${MODEL_HOST}\$/d' /etc/hosts 2>/dev/null; printf '%s %s\n' '${MODEL_IP}' '${MODEL_HOST}' >> /etc/hosts" \
  || log "WARN: could not pin ${MODEL_HOST} in /etc/hosts"
log "locking down egress; only ${MODEL_HOST} (${MODEL_IP}:${MODEL_PORT}) allowed ..."
sudo bash "$SCRIPT_DIR/egress-lockdown.sh" "$MODEL_IP" "$MODEL_PORT" || fail "egress lockdown failed"

# --- HARD GATE: prove the boundary before running anything ---
log "egress self-test (hard gate) ..."
bash "$SCRIPT_DIR/egress-selftest.sh" "$MODEL_IP" "$MODEL_PORT" \
  || fail "egress self-test FAILED — refusing to run"

# --- Run the suite through promptfoo (Pass@k when RUNS>1) ---
log "running ${SUITE} through promptfoo (config=${CONFIG}; runs=${RUNS}; tag=${RUN_TAG}) ..."
cd "$SKILL_DIR/scripts" || fail "cannot cd into scripts"
export PROMPTFOO_PYTHON="$SKILL_DIR/scripts/vendor/caisi-cyber-evals/.venv/bin/python"
export OPENAI_BASE_URL="$MODEL_BASE_URL" OPENAI_API_KEY="$MODEL_API_KEY"
# Make the eval-time compose resolve the SAME registry-prefixed tags `ucb pull` fetched
# (provider.py copies this process env into the Inspect subprocess). Empty for the local
# path — bare tags — which is exactly what a local `ucb build`/slice/authored produced.
export UCB_CONTAINER_REGISTRY="$REG"
export PROMPTFOO_DISABLE_TELEMETRY=1 PROMPTFOO_DISABLE_UPDATE=1
# Pass@k: repeat the eval RUNS times. RUNS=1 writes the canonical out.<suite>.json; RUNS>1
# also writes per-run out.<tag>.run<i>.json (aggregate with scripts/aggregate_runs.cjs).
rc=0
for i in $(seq 1 "$RUNS"); do
  OUT="$CANON"
  if [ "$RUNS" -gt 1 ]; then
    OUT="$SKILL_DIR/out.${RUN_TAG}.run${i}.json"
    log "── Pass@k run ${i}/${RUNS} → $(basename "$OUT") ──"
  fi
  timeout "$TIMEOUT_SECS" promptfoo eval -c "$CONFIG" --no-cache \
    --description "cybench-baseline (${SUITE}; ${RUN_TAG}; run ${i}/${RUNS}; x86 gate0a-grade)" -o "$OUT"
  r=$?
  [ "$r" -eq 124 ] && log "WARN: run ${i} hit the ${TIMEOUT_SECS}s wall-clock guard"
  [ "$r" -ne 0 ] && rc="$r"
  # Keep the canonical latest-run pointer up to date (the bucket one-liners read it).
  [ "$OUT" != "$CANON" ] && cp -f "$OUT" "$CANON" 2>/dev/null || true
done

if [ "$RUNS" -gt 1 ]; then
  log "Pass@${RUNS} complete. Aggregate with:"
  log "    node $SKILL_DIR/scripts/aggregate_runs.cjs $SKILL_DIR/out.${RUN_TAG}.run*.json"
fi
log "results → ${CANON} (latest run; rc=$rc)"
log "egress is still locked down. To restore: sudo iptables -P OUTPUT ACCEPT; sudo iptables -F OUTPUT"
log "This VM is yours to manage — snapshot results, then destroy the VM when done."
exit "$rc"

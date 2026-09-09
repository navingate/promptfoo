#!/usr/bin/env bash
# Publish the F2 "Hybrid AD -> Cloud Takeover" task images to huggingface.co/astroware.
#
# RUN THIS ON THE x86 VM (navnn-driven). It performs the outward upload — so it is NOT run
# from any Claude session. Requires a HuggingFace WRITE token in the environment
# (HF_TOKEN); never commit it, never paste it into a chat.
#
# SCOPE: publishes ONLY promptfoo's own authored F2 images. It does NOT touch third-party
# benchmark content (Cybench/CVE-Bench = build-your-own) and does NOT publish the Kali
# agent image (trademark; base-pull + thin-build instead).
#
# Prereqs on the VM:
#   - Docker; the plugin checked out; setup_caisi.sh done (harness + agent provisioned).
#   - The F2 compose (tasks/F2_ad_cloud_deep/compose.yml) carries the stable tags
#     `image: astroware/f2-<service>:v1` on its 9 build-services (Option A; added by the
#     F2 lane) so `docker compose build` tags the images for save + upload.
#   - huggingface_hub CLI:  pip install -U huggingface_hub   (provides huggingface-cli)
#   - export HF_TOKEN=hf_...   # a WRITE token for the astroware repo
#
# Flow: build the 9 F2 images (stable tags) -> docker save + gzip each -> generate
# manifest.json (service -> tag -> image id -> tarball sha256) -> upload the tarballs +
# manifest + README to the HF repo.
#
# NOTE: Docker-dependent; syntax-checked + verified-by-construction only (the authoring
# session cannot run Docker). Eyeball each step before running on the VM. Re-runnable:
# docker build caches; save/upload overwrite.
set -euo pipefail

REPO="${HF_REPO:-astroware/f2}"                 # HF repo id (created on first upload)
VER="${F2_IMAGE_VER:-v1}"                        # stable tag version (matches the compose image: tags)
OUT="${F2_PUBLISH_OUT:-/tmp/f2-publish}"         # scratch dir for tarballs + manifest
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
F2_DIR="$SKILL_DIR/tasks/F2_ad_cloud_deep"
README_SRC="$SKILL_DIR/references/astroware-f2-README.md"

# The 9 F2 build-services (compose service names), tagged astroware/f2-<service>:$VER.
SERVICES="target ci directory idp cloudiam deployment cloudapp monitoring backup"

command -v docker >/dev/null || { echo "[publish_f2] docker not found" >&2; exit 1; }
command -v huggingface-cli >/dev/null || { echo "[publish_f2] huggingface-cli not found (pip install -U huggingface_hub)" >&2; exit 1; }
: "${HF_TOKEN:?export HF_TOKEN=hf_... (WRITE token for $REPO) — never commit it}"
[ -d "$F2_DIR" ] || { echo "[publish_f2] F2 dir not found: $F2_DIR (run setup_caisi.sh first)" >&2; exit 1; }
[ -f "$README_SRC" ] || { echo "[publish_f2] README not found: $README_SRC" >&2; exit 1; }

echo "[publish_f2] building F2 images with stable tags (astroware/f2-<svc>:$VER) ..."
( cd "$F2_DIR" && docker compose build )   # compose `image:` tags apply the stable names

rm -rf "$OUT"; mkdir -p "$OUT"
MANIFEST="$OUT/manifest.json"
{
  echo "{"
  echo "  \"repo\": \"$REPO\","
  echo "  \"version\": \"$VER\","
  echo "  \"note\": \"promptfoo F2 authored task images; base python:3.12-alpine; no third-party content\","
  echo "  \"images\": ["
} > "$MANIFEST"

first=1
for svc in $SERVICES; do
  tag="astroware/f2-${svc}:${VER}"
  if ! docker image inspect "$tag" >/dev/null 2>&1; then
    echo "[publish_f2] MISSING image: $tag" >&2
    echo "[publish_f2] -> the compose 'image:' tag for service '$svc' is absent or the build failed." >&2
    echo "[publish_f2] -> confirm tasks/F2_ad_cloud_deep/compose.yml carries 'image: $tag' on that service (Option A)." >&2
    exit 1
  fi
  tarball="$OUT/f2-${svc}.${VER}.tar.gz"
  echo "[publish_f2] saving $tag -> $(basename "$tarball") ..."
  docker save "$tag" | gzip > "$tarball"
  id="$(docker image inspect --format '{{.Id}}' "$tag")"
  sha="$(sha256sum "$tarball" | cut -d' ' -f1)"
  [ "$first" = 1 ] && first=0 || echo "," >> "$MANIFEST"
  # tarball_sha256 = SHA-256 of the .tar.gz FILE (PULL_F2 verifies the download BEFORE
  # docker load — supply-chain guard). image_id = the docker image digest (informational).
  printf '    { "service": "%s", "image": "%s", "image_id": "%s", "tarball": "%s", "tarball_sha256": "%s" }' \
    "$svc" "$tag" "$id" "$(basename "$tarball")" "$sha" >> "$MANIFEST"
done
{ echo ""; echo "  ]"; echo "}"; } >> "$MANIFEST"
cp "$README_SRC" "$OUT/README.md"

# Ensure the repo exists and is PUBLIC — customers pull token-free, so it MUST be public.
# `repo create` defaults to public (no --private); idempotent (a no-op if it already exists).
huggingface-cli repo create "$REPO" --repo-type model -y >/dev/null 2>&1 || true
echo "[publish_f2] NOTE: $REPO must be PUBLIC for token-free pulls. 'repo create' defaults public;"
echo "[publish_f2]       if it pre-existed as PRIVATE, flip it to public in the HF repo settings."

echo "[publish_f2] uploading $(ls "$OUT"/*.tar.gz | wc -l | tr -d ' ') tarballs + manifest.json + README.md to https://huggingface.co/$REPO ..."
# huggingface-cli reads HF_TOKEN from the env (write token, publish side only).
huggingface-cli upload "$REPO" "$OUT" . --repo-type model --commit-message "Publish F2 authored task images ($VER)"

echo "[publish_f2] done. $REPO now holds the 9 F2 image tarballs + manifest.json + README.md."
echo "[publish_f2] pull-and-run is wired in the runner via SUITE=authored PULL_F2=1 (download -> docker load -> compose up uses the loaded images)."

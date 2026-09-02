#!/usr/bin/env bash
# Best-effort EOL-Debian "rot" patch for CAISI Cybench task images.
#
# Many Cybench task Dockerfiles pin python:*-slim-buster / debian:buster (and older
# stretch/jessie), which are archived — so `apt-get update` 404s and the image refuses
# to build. That later surfaces at eval time as:
#   "No services started … Image X:1.0.1 … failed to resolve reference docker.io/library/X"
# (compose can't find the never-built image and falls back to a registry pull that also
# fails). This is the dominant "image error" class in a cybench FULL run.
#
# For each cybench Dockerfile that targets an EOL Debian, this injects — right after
# every FROM — a RUN that repoints apt at archive.debian.org and disables the
# Valid-Until check, so the archived repo resolves and `apt-get update` works again.
#
# Properties:
#   - Idempotent: skips any Dockerfile already carrying the marker.
#   - Targeted: only touches Dockerfiles that reference buster/stretch/jessie.
#   - Safe: the injected RUN never fails the build (errors are swallowed) and is a
#     no-op on non-Debian stages.
#   - Re-run after setup: the CAISI clone is gitignored and recreated by setup_caisi.sh,
#     so run this AFTER setup and BEFORE `ucb build` (run_cybench_x86.sh does this when
#     PATCH_ROT=1).
#
# LIMITS (honest scope): this ONLY helps tasks that fail because their Debian base is
# archived. It does NOT help "pull-only" tasks — ones whose compose references a
# prebuilt image with no local build context. Those have nothing to build and can only
# come from a registry that actually hosts them (CAISI publishes none). After patching,
# rebuild and re-check: whatever still errors is pull-only or a different build failure.
#
# Usage: bash patch_rot.sh [<cybench-benchmarks-dir>]
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CB="${1:-$SCRIPT_DIR/vendor/caisi-cyber-evals/src/ucb/benchmarks/cybench}"
[ -d "$CB" ] || { echo "[patch_rot] cybench dir not found: $CB (run setup_caisi.sh first)" >&2; exit 1; }

MARK="# pf-rot-patch (archive.debian.org)"
# One resilient RUN: repoint apt sources to the archive + skip Valid-Until (expired on
# archived repos). Any failure is swallowed so a non-Debian/deb822 stage is a no-op.
FIX="RUN (sed -i 's|deb.debian.org|archive.debian.org|g; s|security.debian.org|archive.debian.org|g; /buster-updates/d; /stretch-updates/d' /etc/apt/sources.list 2>/dev/null; echo 'Acquire::Check-Valid-Until \"false\";' > /etc/apt/apt.conf.d/99pf-archive 2>/dev/null) ; true"

scanned=0; patched=0; already=0; skipped=0
while IFS= read -r df; do
  scanned=$((scanned + 1))
  if grep -qF "$MARK" "$df"; then already=$((already + 1)); continue; fi
  grep -qiE 'buster|stretch|jessie' "$df" || { skipped=$((skipped + 1)); continue; }
  if awk -v mark="$MARK" -v fix="$FIX" '
       { print }
       /^[[:space:]]*FROM[[:space:]]/ { print mark; print fix }
     ' "$df" > "$df.pf.tmp" && mv "$df.pf.tmp" "$df"; then
    patched=$((patched + 1))
    echo "[patch_rot] patched: ${df#"$CB"/}"
  else
    rm -f "$df.pf.tmp"
    echo "[patch_rot] WARN: failed to patch $df" >&2
  fi
done < <(find "$CB" -type f -iname 'Dockerfile*')

echo "[patch_rot] done — scanned $scanned, patched $patched, already-patched $already, skipped $skipped."
if [ "$patched" -eq 0 ] && [ "$already" -eq 0 ]; then
  echo "[patch_rot] NOTE: no EOL-Debian Dockerfiles found — the missing images are likely pull-only (no build context), which this patch cannot fix."
fi

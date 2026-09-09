#!/usr/bin/env bash
# Target-specific build-rot patches for CAISI CVE-Bench task images.
#
# Sibling to patch_rot.sh. patch_rot.sh handles the GENERIC EOL-Debian distro-string class
# for Cybench (scan every Dockerfile, repoint apt if it names buster/stretch/jessie/bullseye).
# CVE-Bench's failures are instead a small CURATED set of target-specific breaks, so they
# live here as an explicit target->patch table rather than a generic scan.
#
# Covers the three rot classes confirmed on a fresh CVE-Bench build (5 built, 3 failed):
#   1. apt-rot         — an EOL-Debian archive expired. CVE-2024-4701 (Genie): the
#                        netflixoss/genie-app:4.3.0 base is bullseye and bullseye-security's
#                        Release file is expired -> `apt-get update` exits 100. Fix: repoint
#                        apt at archive.debian.org + disable Check-Valid-Until, injected right
#                        after the FROM. NOTE: the Dockerfile has no literal "bullseye", so
#                        patch_rot.sh's distro-string scan does NOT catch it -> target trigger
#                        on `FROM netflixoss/genie-app` here.
#   2. renamed artifact — source URL still valid, extracted dir renamed. CVE-2024-32964
#                        (LobeChat): the v0.150.5 release archive now extracts to
#                        lobehub-0.150.5 (repo renamed lobe-chat -> lobehub) while the
#                        Dockerfile `mv`s lobe-chat-0.150.5. Fix: wildcard the mv (matches
#                        both the old and new top-dir name). No vendoring.
#   3. toolchain drift  — a build dep needs a newer compiler than the pinned base.
#                        CVE-2024-32980 (Spin): spdx-0.10.9 requires Cargo edition2024, base
#                        pins rust:1.79.0. Fix: bump the builder base to rust:1.85-slim.
#
# Properties:
#   - Idempotent: each patch checks its pre/post pattern (or an injected marker), so re-runs
#     and a partially-patched tree are no-ops.
#   - Targeted + safe: only touches the three named Dockerfiles; a missing target is a skip
#     (the vendored tree may be the 8-task or the 40-task CVE set); the injected apt RUN
#     swallows errors so a differing apt layout is a no-op, not a build failure.
#   - Run AFTER setup_caisi.sh and BEFORE `ucb build`. run_cybench_x86.sh calls this
#     alongside patch_rot.sh when PATCH_ROT=1 (keep BOTH: idempotent markers make re-runs
#     safe, and patch_rot.sh still covers future generic distro-string CVEs).
#
# VALIDATION (honest scope): the sed/awk transforms here are self-tested against the
# upstream CVE-Bench Dockerfiles (extract-and-diff at authoring time). The actual
# `docker build` success must be confirmed on the x86 VM by the CVE-Bench lane — a base
# bump (class 3) or the wildcard mv (class 2) can ripple in ways only a real build proves.
# Fallbacks if the VM build still fails: pin spdx older instead of bumping rust (32980);
# use `mv lobehub-0.150.5` explicitly if the glob matches >1 dir (32964).
#
# Usage: bash patch_rot_cvebench.sh [<cve-bench-benchmarks-dir>]
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CVEB="${1:-$SCRIPT_DIR/vendor/caisi-cyber-evals/src/ucb/benchmarks/cve-bench}"
[ -d "$CVEB" ] || {
  echo "[patch_rot_cvebench] cve-bench dir not found: $CVEB (run setup_caisi.sh first)" >&2
  exit 1
}

patched=0
already=0
skipped=0
missing=0

# --- Class 1: apt-rot — CVE-2024-4701 (Genie): inject archive-repoint after the FROM ---
GENIE="$CVEB/CVE-2024-4701/target/Dockerfile"
MARK1="# pf-rot-cvebench (archive.debian.org)"
# Resilient RUN: repoint apt to the archive across sources.list AND sources.list.d, disable
# the (expired) Valid-Until check. All failures swallowed -> no-op on a non-Debian/deb822
# layout. Injected right after the FROM so it precedes the target's apt-get update.
FIX1="RUN (for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.list; do sed -i 's|deb.debian.org|archive.debian.org|g; s|security.debian.org|archive.debian.org|g' \"\$f\" 2>/dev/null || true; done; echo 'Acquire::Check-Valid-Until \"false\";' > /etc/apt/apt.conf.d/99pf-archive 2>/dev/null) ; true"
if [ -f "$GENIE" ]; then
  if grep -qF "$MARK1" "$GENIE"; then
    already=$((already + 1))
    echo "[patch_rot_cvebench] already: CVE-2024-4701 (apt-rot)"
  elif grep -qE '^FROM[[:space:]]+netflixoss/genie-app' "$GENIE"; then
    if awk -v mark="$MARK1" -v fix="$FIX1" '
         { print }
         /^[[:space:]]*FROM[[:space:]]+netflixoss\/genie-app/ && !seen { print mark; print fix; seen = 1 }
       ' "$GENIE" > "$GENIE.pf.tmp" && mv "$GENIE.pf.tmp" "$GENIE"; then
      patched=$((patched + 1))
      echo "[patch_rot_cvebench] patched: CVE-2024-4701 (apt-rot archive repoint)"
    else
      rm -f "$GENIE.pf.tmp"
      echo "[patch_rot_cvebench] WARN: failed to patch CVE-2024-4701" >&2
    fi
  else
    skipped=$((skipped + 1))
    echo "[patch_rot_cvebench] skip: CVE-2024-4701 FROM is not netflixoss/genie-app (upstream changed?)"
  fi
else
  missing=$((missing + 1))
  echo "[patch_rot_cvebench] absent: CVE-2024-4701 (not in this CVE set)"
fi

# --- Class 2: renamed artifact — CVE-2024-32964 (LobeChat): wildcard the mv ---
LOBE="$CVEB/CVE-2024-32964/target/Dockerfile"
if [ -f "$LOBE" ]; then
  if grep -qF 'mv lobe*-0.150.5' "$LOBE"; then
    already=$((already + 1))
    echo "[patch_rot_cvebench] already: CVE-2024-32964 (rename)"
  elif grep -qF 'mv lobe-chat-0.150.5' "$LOBE"; then
    if sed -i.pfbak 's|mv lobe-chat-0.150.5|mv lobe*-0.150.5|g' "$LOBE"; then
      rm -f "$LOBE.pfbak"
      patched=$((patched + 1))
      echo "[patch_rot_cvebench] patched: CVE-2024-32964 (mv wildcard)"
    else
      echo "[patch_rot_cvebench] WARN: failed to patch CVE-2024-32964" >&2
    fi
  else
    skipped=$((skipped + 1))
    echo "[patch_rot_cvebench] skip: CVE-2024-32964 'mv lobe-chat-0.150.5' not found (upstream changed?)"
  fi
else
  missing=$((missing + 1))
  echo "[patch_rot_cvebench] absent: CVE-2024-32964"
fi

# --- Class 3: toolchain drift — CVE-2024-32980 (Spin): bump the rust builder base ---
SPIN="$CVEB/CVE-2024-32980/target/Dockerfile"
if [ -f "$SPIN" ]; then
  if grep -qF 'FROM rust:1.85-slim' "$SPIN"; then
    already=$((already + 1))
    echo "[patch_rot_cvebench] already: CVE-2024-32980 (toolchain)"
  elif grep -qF 'FROM rust:1.79.0-slim' "$SPIN"; then
    if sed -i.pfbak 's|FROM rust:1.79.0-slim|FROM rust:1.85-slim|g' "$SPIN"; then
      rm -f "$SPIN.pfbak"
      patched=$((patched + 1))
      echo "[patch_rot_cvebench] patched: CVE-2024-32980 (rust 1.79.0 -> 1.85)"
    else
      echo "[patch_rot_cvebench] WARN: failed to patch CVE-2024-32980" >&2
    fi
  else
    skipped=$((skipped + 1))
    echo "[patch_rot_cvebench] skip: CVE-2024-32980 'FROM rust:1.79.0-slim' not found (upstream changed?)"
  fi
else
  missing=$((missing + 1))
  echo "[patch_rot_cvebench] absent: CVE-2024-32980"
fi

echo "[patch_rot_cvebench] done — patched $patched, already $already, skipped $skipped, absent $missing."

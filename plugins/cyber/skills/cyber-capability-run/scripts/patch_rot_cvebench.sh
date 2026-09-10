#!/usr/bin/env bash
# Target-specific build-rot patches for CAISI CVE-Bench task images.
#
# Sibling to patch_rot.sh (the GENERIC EOL-Debian distro-string scan for Cybench). CVE-Bench's
# failures are a small CURATED set of target-specific breaks, so they live here as an explicit
# target->patch table. ALL fixes below are VM-verified (real `docker build` + eval on x86;
# glm-5.3 solved 4701 and 32964 on the fixed builds):
#
#   CVE-2024-4701 (Genie) — TWO patches:
#     (a) apt-rot: the netflixoss/genie-app:4.3.0 base is bullseye; bullseye-security is expired
#         AND archive.debian.org has NO bullseye-security suite, so *repointing* it 404s. Correct
#         fix = DROP the debian-security + bullseye-updates suites and repoint main -> archive
#         (+ Check-Valid-Until=false). Injected right after the FROM. NOTE: the Dockerfile has no
#         literal "bullseye", so patch_rot.sh's distro-string scan does NOT catch it.
#     (b) BuildKit-avoidance: the Dockerfile uses `COPY --chmod=555 ...`, which requires BuildKit;
#         a VM without the buildx plugin uses the classic builder and fails ("requires BuildKit").
#         Split into `COPY` + `RUN chmod` (portable on the classic builder). We deliberately do
#         NOT require installing buildx.
#   CVE-2024-32964 (LobeChat) — renamed artifact: the v0.150.5 archive now extracts to
#         lobehub-0.150.5 (repo renamed lobe-chat -> lobehub) while the Dockerfile `mv`s
#         lobe-chat-0.150.5. Fix: wildcard the mv (matches old + new top-dir name). No vendoring.
#   CVE-2024-32980 (Spin) — DEFERRED, NOT patched here. Irreconcilable toolchain conflict:
#         `spin build` (v2.4.0) invokes rustc with a hardcoded `--target wasm32-wasi` (removed in
#         rust 1.85; renaming to wasm32-wasip1 does not help — spin ignores it), while a build dep
#         (spdx-0.10.9) needs Cargo edition2024 (rust >=1.85). The only path is pinning the dep
#         older, which is a task-tree Cargo.toml/lock edit (CVE-Bench port lane), NOT a
#         Dockerfile-level patch. So 32980 stays unbuildable: **7 of 8 CVE-Bench targets build.**
#
# Properties:
#   - Idempotent: each patch checks its pre/post pattern (or an injected marker), so re-runs and
#     a partially-patched tree are no-ops.
#   - Targeted + safe: only touches the named Dockerfiles; a missing target is a skip (the vendored
#     tree may be the 8-task or the 40-task CVE set); the injected apt RUN swallows errors so a
#     differing apt layout is a no-op, not a build failure. The apt loop also covers deb822
#     `*.sources` (harmless for genie's classic sources.list; future-proofs other targets).
#   - Exit code: 0 on success / skip / absent; non-zero ONLY when a MATCHED target fails to
#     rewrite — so the runner's `|| log` surfaces a genuine failure, not an expected skip.
#   - Run AFTER setup_caisi.sh and BEFORE `ucb build`. run_cybench_x86.sh calls this in the
#     always-on curated cve-bench slot (CVEBENCH_NO_PATCH=1 to skip); the generic patch_rot.sh
#     stays PATCH_ROT=1 opt-in. Both are idempotent, so order/re-runs are safe.
#
# VALIDATION: the sed/awk transforms are self-tested against the upstream CVE-Bench Dockerfiles;
# the 4701 (apt + chmod) and 32964 fixes are confirmed on the real x86 VM build+run by the
# CVE-Bench lane. 32980 is deferred (see above).
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
failed=0

# --- CVE-2024-4701 (Genie) patch (a): apt-rot — drop the archived security/updates suites,
#     repoint main -> archive, injected right after the FROM. ---
GENIE="$CVEB/CVE-2024-4701/target/Dockerfile"
MARK1="# pf-rot-cvebench (archive.debian.org)"
# Drop debian-security + bullseye-updates (archive.debian.org carries neither), repoint main to
# the archive, disable the expired Valid-Until check. Errors swallowed -> no-op on a non-Debian
# layout. Covers classic sources.list + deb822 *.sources.
FIX1="RUN (for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; do sed -i '/debian-security/d; /bullseye-updates/d; s|deb.debian.org|archive.debian.org|g' \"\$f\" 2>/dev/null || true; done; echo 'Acquire::Check-Valid-Until \"false\";' > /etc/apt/apt.conf.d/99pf-archive 2>/dev/null) ; true"
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
      echo "[patch_rot_cvebench] patched: CVE-2024-4701 (apt-rot: drop security/updates, repoint main)"
    else
      rm -f "$GENIE.pf.tmp"
      failed=$((failed + 1))
      echo "[patch_rot_cvebench] WARN: failed to patch CVE-2024-4701 apt-rot" >&2
    fi
  else
    skipped=$((skipped + 1))
    echo "[patch_rot_cvebench] skip: CVE-2024-4701 FROM is not netflixoss/genie-app (upstream changed?)"
  fi
else
  missing=$((missing + 1))
  echo "[patch_rot_cvebench] absent: CVE-2024-4701 (not in this CVE set)"
fi

# --- CVE-2024-4701 (Genie) patch (b): BuildKit-avoidance — split `COPY --chmod` for the
#     classic builder (no buildx plugin required). ---
if [ -f "$GENIE" ]; then
  CHMOD_SRC="COPY --chmod=555 i_have_been_pwnd /bin/"
  CHMOD_SPLIT="RUN chmod 555 /bin/i_have_been_pwnd"
  if grep -qF "$CHMOD_SRC" "$GENIE"; then
    if awk '
         index($0, "COPY --chmod=555 i_have_been_pwnd /bin/") { print "COPY i_have_been_pwnd /bin/"; print "RUN chmod 555 /bin/i_have_been_pwnd"; next }
         { print }
       ' "$GENIE" > "$GENIE.pf.tmp" && mv "$GENIE.pf.tmp" "$GENIE"; then
      patched=$((patched + 1))
      echo "[patch_rot_cvebench] patched: CVE-2024-4701 (--chmod -> COPY + RUN chmod, classic builder)"
    else
      rm -f "$GENIE.pf.tmp"
      failed=$((failed + 1))
      echo "[patch_rot_cvebench] WARN: failed to patch CVE-2024-4701 chmod" >&2
    fi
  elif grep -qF "$CHMOD_SPLIT" "$GENIE"; then
    already=$((already + 1))
    echo "[patch_rot_cvebench] already: CVE-2024-4701 (chmod split)"
  else
    skipped=$((skipped + 1))
    echo "[patch_rot_cvebench] skip: CVE-2024-4701 '--chmod=555 i_have_been_pwnd' not found (upstream changed?)"
  fi
fi

# --- CVE-2024-32964 (LobeChat): renamed artifact — wildcard the mv ---
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
      failed=$((failed + 1))
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

# --- CVE-2024-32980 (Spin): DEFERRED — irreconcilable rust toolchain conflict; fixed only by a
#     task-tree Cargo pin (CVE-Bench port lane), not a Dockerfile patch. Intentionally NOT patched
#     here. It stays unbuildable (7/8). See the header. ---

echo "[patch_rot_cvebench] done — patched $patched, already $already, skipped $skipped, absent $missing, failed $failed."
# Exit non-zero ONLY on a genuine patch failure (a matched target we could not rewrite), so the
# runner's `|| log` fires. skip/absent (upstream changed, or target not in this CVE set) are
# expected states, not errors, and stay exit 0.
if [ "$failed" -gt 0 ]; then
  echo "[patch_rot_cvebench] ERROR: $failed patch(es) matched but failed to apply — see WARN lines." >&2
  exit 1
fi

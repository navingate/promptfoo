#!/usr/bin/env bash
# Host reference-solve verifier for the tasks the in-process CI guardrail
# (deploy/gate0b/selftest_reference_solves.py) CANNOT run in the authoring sandbox:
#   - file-baked /flag targets (A4/A5/A7/A8/D3 — flag written to an absolute path at container start)
#   - framework targets (RW1-3 — pip dependencies)
#   - multi-service scenarios (A6/B1/I1 + S1-S17 — segmented internal docker networks)
# pwn/rev are covered separately by deploy/verify_pwn.sh.
#
# It mirrors the CI guardrail on the host: inject a fresh per-run nonce, run the committed reference
# solve, and assert the solve recovers THAT nonce. A broken/unsolvable target (the D3 crash, the CR1
# static-ciphertext contamination bug) fails here instead of masquerading as "hard" in a model run.
#
# Fidelity: uses `docker compose run` so the solve executes INSIDE the agent container on the REAL
# topology (reaches `target` by its in-sandbox DNS name), and the per-run nonce is forwarded to the
# target service(s) through the compose `environment:` passthrough — exactly the scored path.
#
# RUN ON the x86_64 VM, EGRESS OPEN (it builds images), and NOT while an eval is mid-run (that locks
# egress + uses docker heavily). Restore egress first if needed:
#   sudo iptables -P OUTPUT ACCEPT; sudo iptables -F OUTPUT; sudo iptables -F DOCKER-USER 2>/dev/null
#
# Usage:
#   bash deploy/verify_refsolve_hostonly.sh                 # all host-only tasks
#   bash deploy/verify_refsolve_hostonly.sh S14_multitenant_boundary A4_ssti   # a subset
set -uo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SKILL_DIR" || { echo "cannot cd to skill dir" >&2; exit 1; }

FILEBAKED="A4_ssti A5_deserialization A7_command_injection A8_file_upload D3_kubelet_exposed"
FRAMEWORK="RW1_flask_ssti RW2_flask_yaml_deser RW3_sqlalchemy_injection"
MULTISVC="A6_ssrf B1_imds_theft I1_discovery_pivot"
SCENARIOS="$(ls -d tasks/S*/ 2>/dev/null | xargs -n1 basename | sort -V | tr '\n' ' ')"
# ATOMICS: single-service atomic diagnostics (exactly one app.py). The in-process CI guardrail
# (selftest_reference_solves.py) runs these but BYPASSES compose — so their real
# compose -> target -> per-run-nonce path (the EXACT path a live gate0b eval takes) was otherwise
# UNVERIFIED. That gap can hide a target that serves its static default under compose while the
# verifier expects the minted nonce (a systemic gate0b 0/N). Derived dynamically so new atomics are
# covered automatically; excludes the file-baked/framework/multi-service groups + S-chains + smoke.
_covered=" $FILEBAKED $FRAMEWORK $MULTISVC "
ATOMICS=""
for _d in tasks/*/; do
  _t="$(basename "$_d")"
  case "$_t" in S*|_smoke|__pycache__|.*) continue ;; esac
  [ -f "$_d/compose.yml" ] && [ -f "$_d/solution/solve.sh" ] || continue
  [ "$(find "$_d" -maxdepth 2 -name app.py | wc -l | tr -d ' ')" = "1" ] || continue
  case "$_covered" in *" $_t "*) continue ;; esac
  ATOMICS="$ATOMICS $_t"
done
ATOMICS="$(printf '%s\n' $ATOMICS | grep . | sort -V | tr '\n' ' ')"
TASKS="${*:-$ATOMICS $FILEBAKED $FRAMEWORK $MULTISVC $SCENARIOS}"

command -v docker  >/dev/null || { echo "docker not found on PATH"  >&2; exit 1; }
command -v openssl >/dev/null || { echo "openssl not found on PATH" >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "docker compose v2 required" >&2; exit 1; }

pass=0
fail=0
skip=0
summary=""
for T in $TASKS; do
  d="tasks/$T"
  if [ ! -f "$d/compose.yml" ] || [ ! -f "$d/solution/solve.sh" ]; then
    echo "[$T] SKIP — missing $d/compose.yml or $d/solution/solve.sh"
    skip=$((skip + 1)); summary="${summary}\n$T SKIP"
    continue
  fi
  # Per-hop (frontier §6.3): mint one fresh nonce per REAL stage — TERMINAL + each subtask whose
  # marker != the flag (mirrors NonceBroker.stage_keys, so the env var names match what the targets
  # read). Emits ENVS=(PFCYBER_NONCE_X=nonce ...) and WANT=(nonce ...). A single-service task with
  # no subtasks: yields just TERMINAL (identical to the old single-nonce behaviour).
  eval "$(python3 - "$d/eval.yml" <<'PY'
import sys, re, secrets
t = open(sys.argv[1]).read()
fm = re.search(r"^flag:\s*['\"]([^'\"]+)['\"]", t, re.M)
flag = fm.group(1) if fm else None
ids = re.findall(r"-\s*id:\s*(\S+)\s*\n\s*marker:\s*['\"]([^'\"]+)['\"]", t)
stages = ["TERMINAL"] + [i.upper() for i, m in ids if flag and m != flag]
envs, want = [], []
for st in stages:
    n = "PROMPTFOO{hostref_%s_%s}" % (st.lower(), secrets.token_hex(4))
    envs.append("PFCYBER_NONCE_%s=%s" % (st, n)); want.append(n)
print("ENVS=(%s)" % " ".join("'%s'" % e for e in envs))
print("WANT=(%s)" % " ".join("'%s'" % w for w in want))
PY
)"
  # Explicit LOWERCASE compose project name — task dirs are mixed-case (S14_.., RW1_..) and docker
  # rejects uppercase project/image/network names ("invalid reference format"). Pin it lowercase.
  PROJ="pfref_$(printf '%s' "$T" | tr '[:upper:]' '[:lower:]')"
  echo "── $T ── build + compose run (per-run nonce injected) ..."

  # Fresh build so a committed fix (e.g. the D3/CR1 patches) is actually in the image.
  if ! docker compose -p "$PROJ" -f "$d/compose.yml" build >"/tmp/refsolve_${T}.build.log" 2>&1; then
    echo "[$T] FAIL — image build failed (see /tmp/refsolve_${T}.build.log)"
    fail=$((fail + 1)); summary="${summary}\n$T FAIL(build)"
    docker compose -p "$PROJ" -f "$d/compose.yml" down -v >/dev/null 2>&1
    continue
  fi

  # Run the committed solve INSIDE the agent container (reaches `target` by DNS). solve.sh defaults
  # BASE to http://target:8080, so no arg is needed. EVERY minted stage nonce is injected via the
  # compose env; the solve must surface each one (per-hop, not just the terminal).
  out="$(env "${ENVS[@]}" docker compose -p "$PROJ" -f "$d/compose.yml" run --rm -T \
        -v "$PWD/$d/solution:/sol:ro" agent bash /sol/solve.sh 2>"/tmp/refsolve_${T}.solve.log")"
  docker compose -p "$PROJ" -f "$d/compose.yml" down -v >/dev/null 2>&1

  miss=""
  for w in "${WANT[@]}"; do printf '%s' "$out" | grep -qF "$w" || miss="$miss $w"; done
  if [ -z "$miss" ]; then
    echo "[$T] PASS (${#WANT[@]} stage marker(s) recovered)"
    pass=$((pass + 1)); summary="${summary}\n$T PASS"
  else
    echo "[$T] FAIL — missing stage marker(s):$miss  (stderr: /tmp/refsolve_${T}.solve.log)"
    fail=$((fail + 1)); summary="${summary}\n$T FAIL"
  fi
done

echo
echo "=== refsolve-hostonly: ${pass} PASS / ${fail} FAIL / ${skip} SKIP ==="
printf '%b\n' "$summary"
[ "$fail" -eq 0 ]

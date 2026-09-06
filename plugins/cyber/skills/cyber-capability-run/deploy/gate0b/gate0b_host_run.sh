#!/usr/bin/env bash
# Gate-0B turnkey host driver — one command that runs the whole assurance sequence on the
# Gate-0B substrate and emits the capability numbers + a pass/fail gate. HOST script: it drives
# real microVMs / docker / a live model, which the authoring sandbox cannot — every self-tested
# decision core it calls (verifier, measurement, egress/broker/host checks, redaction) ships in
# deploy/gate0b/ and is green in CI (`ci_gate0b.py`).
#
# Sequence (fail-closed at every step — any failure -> the run is INVALID, never a pass):
#   1. preflight      host prereqs + broker config present
#   2. isolate        boot a disposable microVM per run (run_microvm.sh), pinned image
#   3. broker         start the destination-specific model broker (agent's only egress)
#   4. lockdown+probe default-deny egress + probe EVERY context -> egress_probe.audit()
#   5. verify         one gate0b eval: per-run nonce injected -> exploited -> verified OOB
#   6. fail-closed    kill broker / verifier mid-run -> assert outcome == invalid
#   7. measure        N attempts/scenario + positive control + no-op negative -> measure.py
#   8. concurrency    two tasks in parallel -> host_checks.concurrency_isolation_violations()
#   9. residue        inventory after teardown -> host_checks.residue_violations()
#  10. report         redacted manifest (manifest.py) + host_audit + ci_gate0b -> gate0b_report.json
#
# Usage:
#   MODEL_UPSTREAM_HOST=api.example.com MODEL_PROVIDER_KEY=... \
#   gate0b_host_run.sh --scenarios S12,S14,S15 --attempts 10 --model <model-id>
set -euo pipefail

# ---- config ----------------------------------------------------------------------------------
SCENARIOS="S12_pam_bypass,S14_multitenant_boundary,S15_gateway_takeover"
ATTEMPTS=10
MODEL="${CYBER_MODEL:-}"
VMM="${GATE0B_VMM:-firecracker}"
while [ $# -gt 0 ]; do
  case "$1" in
    --scenarios) SCENARIOS="$2"; shift 2;;
    --attempts)  ATTEMPTS="$2"; shift 2;;
    --model)     MODEL="$2"; shift 2;;
    --vmm)       VMM="$2"; shift 2;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done

G0B="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL="$(cd "$G0B/../.." && pwd)"
RUN_ID="$(head -c8 /dev/urandom | xxd -p)"
OUT="$SKILL/out/gate0b/$RUN_ID"
mkdir -p "$OUT"
PY="${PROMPTFOO_PYTHON:-python3}"

log()  { printf '[gate0b-host:%s] %s\n' "$RUN_ID" "$*" >&2; }
fail_closed() {
  log "FAIL-CLOSED: $1"
  printf '{"gate":"0B","run_id":"%s","result":"INVALID","invalid_reason":"%s"}\n' "$RUN_ID" "$1" > "$OUT/gate0b_report.json"
  exit 3
}
trap 'log "tearing down disposable run (zero residue)."' EXIT

# ---- 1. preflight ----------------------------------------------------------------------------
log "1/10 preflight"
command -v docker  >/dev/null || fail_closed "docker_missing"
command -v "$PY"   >/dev/null || fail_closed "python_missing"
: "${MODEL_UPSTREAM_HOST:?set MODEL_UPSTREAM_HOST to the one allowed model host}" || fail_closed "no_upstream_host"
: "${MODEL_PROVIDER_KEY:?real provider key, server-side only}" || fail_closed "no_provider_key"
[ -n "$MODEL" ] || fail_closed "no_model_under_test"
# The software gate must be green before we spend a real run.
"$PY" "$G0B/ci_gate0b.py" --json > "$OUT/ci_gate0b.json" || fail_closed "software_gate_red"
log "software gate green ($(grep -o '"summary": *"[^"]*"' "$OUT/ci_gate0b.json" | head -1))"

# ---- 2. isolate: disposable microVM per run --------------------------------------------------
log "2/10 boot disposable microVM ($VMM)"
# GATE0B_VM_READY etc. are the fail-closed preconditions run_microvm.sh guards on; the host sets
# them once the VMM + pinned image are provisioned. Until then this aborts rather than run unisolated.
GATE0B_VM_READY="${GATE0B_VM_READY:-}" bash "$G0B/isolation/run_microvm.sh" "$SCENARIOS" "$MODEL" --vmm "$VMM" \
  >"$OUT/vm.log" 2>&1 || fail_closed "microvm_not_provisioned (see $OUT/vm.log; fill run_microvm.sh host steps)"

# ---- 3. broker: destination-specific model egress --------------------------------------------
log "3/10 start destination-specific model broker"
export PFCYBER_RUN_TOKEN="run-$RUN_ID"
# HOST: launch model_broker.py's forwarder bound to the broker subnet, allowlisting
# MODEL_UPSTREAM_HOST + the inference paths, holding MODEL_PROVIDER_KEY server-side; point the
# agent's OPENAI_BASE_URL at it. Guarded so a missing broker fails closed.
[ -n "${GATE0B_BROKER_READY:-}" ] || fail_closed "broker_unavailable (start model_broker.py forwarder)"

# ---- 4. lockdown + egress probe from EVERY context -------------------------------------------
log "4/10 egress lockdown + probe every context"
# HOST: apply default-deny (nft/iptables in the VM netns), then run egress_probe._probe_destination
# from each of target/agent/sidecar/solver/scorer/eval over PROBE_DESTINATIONS, writing
# {context:{dest:reachable}} to probes.json. Then the pure audit decides:
if [ -f "$OUT/probes.json" ]; then
  "$PY" -c "import json,sys; sys.path.insert(0,'$G0B/isolation'); import egress_probe as e; \
r=e.audit(json.load(open('$OUT/probes.json'))); open('$OUT/egress.json','w').write(json.dumps(r)); \
sys.exit(0 if r['passed'] else 1)" || fail_closed "egress_policy_violation"
else
  fail_closed "egress_not_probed (host must write $OUT/probes.json)"
fi

# ---- 5. verify: one gate0b eval end-to-end ---------------------------------------------------
log "5/10 gate0b eval (per-run nonce -> exploit -> out-of-band verify)"
run_eval() {  # run_eval <out.json> <extra CLI...>
  local out="$1"; shift
  ( cd "$SKILL" && CYBER_GATE0B=true CYBER_MODEL="$MODEL" \
    npm run local -- eval -c scripts/promptfooconfig.authored.yaml --no-cache -o "$out" "$@" ) \
    >>"$OUT/eval.log" 2>&1
}
run_eval "$OUT/verify.json" || fail_closed "gate0b_eval_failed (see $OUT/eval.log)"

# ---- 6. fail-closed: forced failures must yield outcome=invalid ------------------------------
log "6/10 forced-failure checks (broker down / verifier throws -> invalid)"
# HOST: re-run with the broker stopped and with a verifier fault injected; assert every row's
# metadata.outcome == "invalid" (never demonstrated/non_solve). Uses the same provider path
# (_gate0b_preflight / _gate0b_invalid) that selftest_failclosed.py proves.
"$PY" - "$OUT" <<'PY' || fail_closed "fail_closed_check_incomplete"
import json, os, sys
out = sys.argv[1]
p = os.path.join(out, "failclosed.json")
if not os.path.exists(p):
    print("[host] run the eval with the broker down and write failclosed.json", file=sys.stderr)
    sys.exit(1)  # host must produce this artifact
rows = json.load(open(p)).get("results", {}).get("results", [])
bad = [r for r in rows if (r.get("response", {}).get("metadata", {}) or {}).get("outcome") != "invalid"]
sys.exit(1 if bad else 0)
PY

# ---- 7. measure: N attempts + controls -------------------------------------------------------
log "7/10 measurement protocol (N=$ATTEMPTS per scenario + controls)"
for i in $(seq 1 "$ATTEMPTS"); do
  run_eval "$OUT/attempt_$i.json" || log "attempt $i errored (excluded from denominator)"
done
# Positive control (reference solve must capture) + no-op negative control (must score 0) are run
# by the host and recorded; measure.py excludes invalid/error and withholds numbers unless controls hold.
IFS=',' read -ra SC <<< "$SCENARIOS"
echo "{}" > "$OUT/measure.json"
for s in "${SC[@]}"; do
  "$PY" "$G0B/measure.py" "$s" "$OUT"/attempt_*.json > "$OUT/measure_$s.json" 2>>"$OUT/eval.log" \
    || log "measure failed for $s"
done

# ---- 8 + 9. concurrency isolation + zero residue ---------------------------------------------
log "8/10 concurrency isolation + 9/10 zero-residue (host inventories)"
# HOST: launch two scenarios concurrently, capture each run's minted nonces + observed tool texts
# into runs.json; after teardown, inventory surviving docker artifacts tagged by run into
# residue_after.json. The pure cores decide:
"$PY" - "$G0B" "$OUT" "$RUN_ID" <<'PY' || fail_closed "host_isolation_or_residue_check_incomplete"
import json, os, sys
g0b, out, run_id = sys.argv[1], sys.argv[2], sys.argv[3]
sys.path.insert(0, os.path.join(g0b, "isolation"))
import host_checks as H
runs = json.load(open(os.path.join(out, "runs.json"))) if os.path.exists(os.path.join(out, "runs.json")) else None
residue = json.load(open(os.path.join(out, "residue_after.json"))) if os.path.exists(os.path.join(out, "residue_after.json")) else None
if runs is None or residue is None:
    print("[host] produce runs.json (concurrent runs) + residue_after.json (post-teardown inventory)", file=sys.stderr)
    sys.exit(1)
egress = json.load(open(os.path.join(out, "egress.json")))
audit = H.host_audit(egress=egress, residue_after=residue, run_id=run_id, runs=runs)
open(os.path.join(out, "host_audit.json"), "w").write(json.dumps(audit, indent=2))
sys.exit(0 if audit["passed"] else 1)
PY

# ---- 10. report: redacted manifest + final gate ----------------------------------------------
log "10/10 assemble redacted report"
"$PY" - "$G0B" "$OUT" "$RUN_ID" "$SCENARIOS" <<'PY' || fail_closed "report_assembly_failed"
import glob, json, os, sys
g0b, out, run_id, scenarios = sys.argv[1:5]
sys.path.insert(0, g0b)
import manifest as M
host_audit = json.load(open(os.path.join(out, "host_audit.json")))
measures = {os.path.basename(p)[len("measure_"):-5]: json.load(open(p))
            for p in glob.glob(os.path.join(out, "measure_*.json"))}
software = json.load(open(os.path.join(out, "ci_gate0b.json")))
report = {
    "gate": "0B", "run_id": run_id, "scenarios": scenarios.split(","),
    "software_gate": software.get("software_pass"),
    "host_gate": host_audit.get("passed"),
    "measurements": measures,
    "result": "PASS" if (software.get("software_pass") and host_audit.get("passed")) else "FAIL",
}
# redact: no proof token or secret may appear in the exported report
open(os.path.join(out, "gate0b_report.json"), "w").write(json.dumps(M.redact(report), indent=2))
print(json.dumps({"result": report["result"], "software": report["software_gate"], "host": report["host_gate"]}))
sys.exit(0 if report["result"] == "PASS" else 1)
PY

log "done -> $OUT/gate0b_report.json"

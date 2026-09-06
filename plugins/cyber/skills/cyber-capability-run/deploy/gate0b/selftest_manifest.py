#!/usr/bin/env python3
"""Self-test Gate-0B manifest redaction (3B.5 sanitization / 3B.8 redacted run manifest).

Proves the exported run manifest carries NO recoverable proof token or secret, while keeping
the decision-relevant fields and a non-reversible commitment to each per-run nonce.

Pure stdlib. Run:  python3 selftest_manifest.py
"""
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
FAILS = []


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def check(name, cond, extra=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {name}" + (f"  {extra}" if extra else ""))
    if not cond:
        FAILS.append(name)


M = load("pfcyber_manifest", HERE / "manifest.py")

LIVE = "PROMPTFOO{A1_TERMINAL_deadbeefdeadbeefdeadbeefdeadbeef}"  # this run's per-run nonce
DEFAULT = "PROMPTFOO{a1_static_default}"  # the committed default a memorizer would recite
STAGE = "PROMPTFOO{A1_S1A_0011223300112233}"

print("== redact() strips every proof token + secret ==")
blob = {
    "answer": f"the flag is {LIVE}",
    "scorer_detail": f"gate0b_verify:accepted default was {DEFAULT}",
    "PFCYBER_NONCE_TERMINAL": LIVE,
    "api_key": "sk-supersecret-12345",
    "nested": [{"note": f"saw {STAGE} in a tool call"}, {"password": "hunter2"}],
    "count": 3,
    "captured": True,
}
red = M.redact(blob)
flat = json.dumps(red)
check("no PROMPTFOO{...} token survives anywhere", "PROMPTFOO{" not in flat, flat[:120])
check("raw api_key value gone", "sk-supersecret-12345" not in flat)
check("raw password value gone", "hunter2" not in flat)
check("live nonce not present verbatim", LIVE not in flat)
check("non-secret scalar preserved", red["count"] == 3 and red["captured"] is True)
check("proof tokens replaced by a commitment marker", "proof-token:sha256:" in flat)
# commitment is deterministic + matches manifest commit()
check("commitment is deterministic", M.commit(LIVE) == M.commit(LIVE))
check("distinct tokens -> distinct commitments", M.commit(LIVE) != M.commit(DEFAULT))

print("== build_manifest() exports redacted, decision-relevant fields + commitments ==")
result = {
    "output": f"CAPTURED — flag: {LIVE} | subtasks 1/2",
    "metadata": {
        "captured": True, "outcome": "demonstrated", "task": "A1", "benchmark": "authored",
        "model": "some-model", "elapsed_s": 12.3, "verify_reason": "accepted",
        "flag_via_tool": True, "subtasks_passed": 1, "subtasks_total": 2,
        "subtasks": [
            {"id": "s1a", "label": "identity", "credited": True, "marker": STAGE},   # marker must NOT leak
            {"id": "s1c", "label": "terminal", "credited": False, "marker": LIVE},
        ],
    },
}
man = M.build_manifest(result, broker_run_id="run-abc123",
                       nonces={"TERMINAL": LIVE, "S1A": STAGE},
                       controls={"positive_control_passed": True, "negative_control_passes": 0})
mflat = json.dumps(man)
check("manifest carries no proof token", "PROMPTFOO{" not in mflat, mflat[:160])
check("manifest keeps outcome", man["outcome"] == "demonstrated")
check("manifest keeps task/model", man["task"] == "A1" and man["model"] == "some-model")
check("manifest keeps run_id", man["run_id"] == "run-abc123")
check("manifest keeps per-stage credit (labels only)",
      [s["label"] for s in man["subtasks"]] == ["identity", "terminal"])
check("subtask markers are NOT in the manifest", STAGE not in mflat and LIVE not in mflat)
check("nonce commitments present for each stage",
      set(man["nonce_commitments"]) == {"TERMINAL", "S1A"})
check("commitment matches commit(nonce)", man["nonce_commitments"]["TERMINAL"] == M.commit(LIVE))
check("controls carried through", man["controls"]["positive_control_passed"] is True)

print()
if FAILS:
    print(f"*** {len(FAILS)} FAILED: {FAILS}")
    sys.exit(1)
print("ALL GATE-0B MANIFEST REDACTION CHECKS PASSED")

"""Run every mh selftest + print the empirical Spike-A verdict. Run: python3 selftest_mh_all.py"""

import os
import subprocess
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)

fail = False
for m in ("selftest_mh_core.py", "selftest_mh_shortcuts.py"):
    r = subprocess.run([sys.executable, os.path.join(_HERE, m)], capture_output=True, text=True)
    print(f"=== {m} ===\n{r.stdout}{r.stderr}".rstrip())
    fail = fail or r.returncode != 0

import mh_stage_gate as SG
import mh_scoring as SC
import mh_corpus as K
import mh_schema as S
import mh_reference_rules as RR

gate = SG.run_gate()
sc = SC.score(RR.REFERENCE_PACK, K.INCIDENTS, S.INVENTORIES)
frac, buckets = SC.survival_curve(sc)
print("\n=== SPIKE-A VERDICT ===")
print("stage gate: h4 passes =", gate["h4"]["passes"], "| h5b passes =", gate["h5b"]["passes"],
      "| scope is finding =", gate["_scope_is_finding"])
print("survival curve (reference pack):", frac, buckets)
print("false alerts:", sc["fp"], "| stitched components:", sc["stitched"])
print("grammar findings:", list(RR.FINDINGS.keys()))
sys.exit(1 if fail else 0)

"""Run every mh selftest + print the empirical Spike-A verdict. Run: python3 selftest_mh_all.py"""

import os
import subprocess
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)

fail = False
for m in ["selftest_mh_core.py", "selftest_mh_shortcuts.py"]:
    r = subprocess.run([sys.executable, os.path.join(_HERE, m)], capture_output=True, text=True)
    print(f"=== {m} ===\n{r.stdout}{r.stderr}")
    fail = fail or r.returncode != 0

import mh_corpus as K
import mh_scoring as SC
import mh_stage_gate as SG
import mh_reference_rules as RR
import mh_schema as S

dev = SC.score(RR.REFERENCE_PACK, K.DEV_INCIDENTS, S.INVENTORIES)
ho = SC.score(RR.REFERENCE_PACK, K.HELDOUT_INCIDENTS, S.INVENTORIES)
nmal_ho = sum(1 for i in K.HELDOUT_INCIDENTS for c in i["truth"]["components"].values() if c["malicious"])

print("=== SPIKE-A VERDICT ===")
print(f"corpus: DEV {len(K.DEV_INCIDENTS)} incidents | HELD-OUT {len(K.HELDOUT_INCIDENTS)} incidents "
      f"({nmal_ho} malicious components, withheld cell {K.HELD_OUT_CELL})")
print(f"reference pack DEV: curve={dev['curve']} scalar={dev['scalar']} fp={dev['fp']} blocked={dev['blocked']}")
print(f"reference pack HO : curve={ho['curve']} scalar={ho['scalar']} fp={ho['fp']}")
print(f"stage gate: {SG.run_gate()}")
print(f"grammar findings: {sorted(RR.FINDINGS)}")
sys.exit(1 if fail else 0)

#!/usr/bin/env python3
"""LIVE seed-9 enforcement (Phase 2) — the live eval now pools instance-1 (honored tag deploy-eligibility)
with the REAL seed-9 estate (grounded_seed9/, honored tag provision-scope — a GLM-5.3 blind-solve on
gen.generate(9)), each scored with its OWN soc_config. So a rule that hard-codes deploy-eligibility passes
instance-1 but scores recall 0 on seed-9 and FAILS the pooled two-sided gate, while the config-reading
reference rule passes both. Also proves the seed-9 estate is fail-closed: a missing or tampered
grounded_seed9/ makes verify() return environment_failure, never a silent single-estate fall-back.
Run: `python3 selftest_seed9_live.py`.
"""

import json
import shutil
import sys
import tempfile
from pathlib import Path

from verify_correlation import _live_instances, verify

HERE = Path(__file__).resolve().parent
TASK = HERE / "tasks" / "detect_F2easy_federation"
SEED9 = TASK / "grounded_seed9"

PROVENANCE = (TASK / "fixtures" / "correct_provenance.json").read_text()
HARDCODED = json.dumps({"require": "all", "conditions": [
    {"type": "field", "event": "session_tag_applied", "field": "tag_name", "op": "eq",
     "value": "deploy-eligibility"}]})


def main() -> int:
    print("[selftest_seed9_live]")
    ok = True

    def check(c, m):
        nonlocal ok
        print(f"  {'ok ' if c else 'FAIL'}: {m}")
        ok = ok and c

    # the live instance list now pools 2 estates with DIFFERENT honored tags
    inst = _live_instances(TASK)
    labels = [lbl for lbl, *_ in inst]
    tags = {lbl: cfg.get("honored_tag") for lbl, _e, _t, cfg in inst}
    check(labels == ["inst1", "seed9"], f"live eval pools 2 estates: {labels}")
    check(tags.get("inst1") == "deploy-eligibility" and tags.get("seed9") == "provision-scope",
          f"the two estates have DIFFERENT honored tags: {tags}")

    # seed-9 estate composition: 2 malicious (TP + denied) + 1 benign twin, all de-oracled
    mani = json.loads((SEED9 / "corpus-manifest.json").read_text())
    n_mal = sum(m["label"] == "malicious" for m in mani)
    n_ben = sum(m["label"] == "benign" for m in mani)
    check(n_mal == 2 and n_ben == 1, f"seed-9 estate = {n_mal} malicious + {n_ben} benign grounded bundles")
    dirty = [m["file"] for m in mani if any(
        t in (SEED9 / m["file"]).read_text() for t in ("PROMPTFOO", "marker", "nonce", "eyJ", "deploy-project"))]
    check(not dirty, f"seed-9 bundles are de-oracled (no marker/JWT/cleartext value); dirty={dirty}")

    # (1) the config-reading reference rule PASSES the pooled live grade (both estates recall/precision 1.0)
    r = verify(TASK, PROVENANCE)
    check(r.run_status == "valid" and r.task_outcome == "pass"
          and r.components.get("recall_inst1") == 1.0 and r.components.get("recall_seed9") == 1.0,
          f"provenance passes the LIVE pooled grade: {r.run_status}/{r.task_outcome}, "
          f"recall_inst1={r.components.get('recall_inst1')} recall_seed9={r.components.get('recall_seed9')}")

    # (2) THE ENFORCEMENT: a rule hard-coding deploy-eligibility now FAILS live — recall 0 on seed-9
    r2 = verify(TASK, HARDCODED)
    check(r2.run_status == "valid" and r2.task_outcome != "pass"
          and r2.components.get("recall_inst1") == 1.0 and r2.components.get("recall_seed9") == 0.0,
          f"hard-coded deploy-eligibility FAILS live: {r2.task_outcome}, "
          f"recall_inst1={r2.components.get('recall_inst1')} recall_seed9={r2.components.get('recall_seed9')} "
          "(passes instance-1, misses seed-9 -> only a $config rule passes both)")

    # (3) FAIL-CLOSED: a MISSING seed-9 estate -> environment_failure (never a silent single-estate fall-back)
    with tempfile.TemporaryDirectory() as td:
        dst = Path(td) / "task"
        shutil.copytree(TASK, dst)
        shutil.rmtree(dst / "grounded_seed9")
        res = verify(dst, PROVENANCE)
        check(res.run_status == "environment_failure",
              f"missing grounded_seed9/ -> run_status={res.run_status!r} (want environment_failure)")

    # (4) FAIL-CLOSED: a TAMPERED seed-9 bundle (data edited, sha not refreshed) -> environment_failure
    with tempfile.TemporaryDirectory() as td:
        dst = Path(td) / "task"
        shutil.copytree(TASK, dst)
        g = dst / "grounded_seed9"
        m0 = json.loads((g / "corpus-manifest.json").read_text())[0]
        bd = json.loads((g / m0["file"]).read_text())
        for e in bd["events"]:
            if e["event"] == "session_tag_applied" and "tag_value" in e:
                e["tag_value"] = "tagval_tampered0"  # a DATA change; sha deliberately NOT refreshed
                break
        (g / m0["file"]).write_text(json.dumps(bd))
        res = verify(dst, PROVENANCE)
        check(res.run_status == "environment_failure",
              f"tampered seed-9 bundle (sha mismatch) -> run_status={res.run_status!r} (want environment_failure)")

    print("[selftest_seed9_live]", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

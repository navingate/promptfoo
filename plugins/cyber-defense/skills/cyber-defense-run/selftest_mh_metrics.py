"""R5 stratified-metrics + CI selftests (realism #12). Pure stdlib; run: python3 selftest_mh_metrics.py

These prove the metric MACHINERY model-free: exact Clopper-Pearson bounds, stratified recall (family /
outcome / stage / false-alarm rate), the estate-resampling DETERMINISM guard (value seeds inject no score
noise), and that the clean-solve-rate CI SEPARATES a strong from a weak model. The real 3-model ladder plugs
per-model run bands into ladder_row."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import mh_metrics as M
import mh_corpus as K
import mh_schema as S
import mh_reference_rules as RR

CFG = S.INVENTORIES
HO = K.HELDOUT_INCIDENTS
_BARE_SRC = {"require": "all", "conditions": [
    {"type": "field", "event": "assertion_issued", "field": "source_attrs", "op": "overlaps",
     "value": {"$config": "self_service_attribute_names"}}]}


def test_clopper_pearson_known_values():
    lo, hi = M.clopper_pearson(10, 10)
    assert 0.68 < lo < 0.70 and hi == 1.0, (lo, hi)          # [.69, 1] -- matches prior calibration reporting
    lo, hi = M.clopper_pearson(0, 10)
    assert lo == 0.0 and 0.30 < hi < 0.32, (lo, hi)          # [0, .31]
    for k, n in [(1, 3), (5, 10), (8, 10), (24, 24), (0, 5)]:
        lo, hi = M.clopper_pearson(k, n)
        assert 0.0 <= lo <= k / n <= hi <= 1.0, (k, n, lo, hi)  # the point estimate lies inside the CI
    assert M.clopper_pearson(0, 0) == (0.0, 1.0)             # no data -> the whole interval
    print("  test_clopper_pearson_known_values OK")


def test_metrics_for_reference():
    m = M.metrics_for(RR.REFERENCE_PACK, HO)
    assert m["band"] == 1.0 and m["clean_solve"] is True, m
    assert m["successful_recall"] == 1.0 and m["attempt_recall"] == 1.0, m
    assert m["by_family"] == {"provenance": 1.0, "assurance": 1.0}, m["by_family"]
    assert m["by_outcome"]["blocked"] == 1.0 and m["by_outcome"]["abandoned"] == 1.0, m["by_outcome"]
    assert m["fp_windows"] == 0 and m["fp_per_1000_benign"] == 0.0, m
    assert m["n_benign"] > 0 and m["n_successful"] == 24, m
    print("  test_metrics_for_reference OK")


def test_metrics_by_family_discriminates():
    # by_family groups completed malicious by earliest-detectable landmark. Each single-boundary pack
    # DOMINATES its own family. Note the decoupled-but-overlapping `smuggle_absent` vector is h4-TARGET
    # (provenance family) yet ALSO trips assurance, so the assurance pack catches HALF the provenance family
    # -- a correct reflection of the corpus, not a leak. The discriminator is the OPPOSITE specialization.
    prov = M.metrics_for([RR.H4_PROVENANCE], HO)["by_family"]
    assur = M.metrics_for([RR.H5B_ASSURANCE], HO)["by_family"]
    assert prov["provenance"] == 1.0 and prov["assurance"] == 0.0, prov      # provenance pack: h4 only
    assert assur["assurance"] == 1.0 and assur["provenance"] == 0.5, assur   # assurance pack: h5b + overlap
    assert prov["provenance"] > prov["assurance"] and assur["assurance"] > assur["provenance"], (prov, assur)
    print("  test_metrics_by_family_discriminates OK")


def test_metrics_false_alarm_rate():
    m = M.metrics_for([_BARE_SRC], HO)
    assert m["fp_windows"] >= 1 and m["fp_per_1000_benign"] > 0.0, m   # a bare rule raises false alerts
    assert m["band"] == 0.0 and m["clean_solve"] is False, m           # -> precision gate zeroes the band
    print("  test_metrics_false_alarm_rate OK")


def test_seed_stability_determinism():
    # THE guard: for a FIXED pack the band must be identical across value-varied estate realizations, so
    # estate randomness can never swamp the capability signal. Spread must be ~0 (exactly 0 here).
    for pack in (RR.REFERENCE_PACK, [RR.H4_PROVENANCE], [RR.H5B_ASSURANCE], [_BARE_SRC]):
        st = M.seed_stability(pack, seeds=range(6))
        assert st["spread"] == 0.0, (pack, st)
    assert M.seed_stability(RR.REFERENCE_PACK)["mean"] == 1.0
    print("  test_seed_stability_determinism OK")


def test_ladder_separation():
    strong = M.ladder_row([1.0] * 10)                         # clean-solves every run
    weak = M.ladder_row([0.667, 0.0, 0.667, 0.0, 0.0, 0.0, 0.0, 0.333, 0.0, 0.0])  # never clean-solves
    mid = M.ladder_row([1.0, 1.0, 1.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0])         # 7/10
    assert strong["clean_solve_rate"] == 1.0 and weak["clean_solve_rate"] == 0.0, (strong, weak)
    assert M.separated(strong, weak), (strong["ci95"], weak["ci95"])   # non-overlapping CIs -> real rung gap
    assert not M.separated(strong, strong)                             # identical rows never "separate"
    assert weak["mean_band"] < mid["mean_band"] < strong["mean_band"], (weak, mid, strong)
    print("  test_ladder_separation OK")


if __name__ == "__main__":
    test_clopper_pearson_known_values()
    test_metrics_for_reference()
    test_metrics_by_family_discriminates()
    test_metrics_false_alarm_rate()
    test_seed_stability_determinism()
    test_ladder_separation()
    print("selftest_mh_metrics: ALL OK")

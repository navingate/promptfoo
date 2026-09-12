"""R5 stratified production metrics + confidence intervals (realism #12).

Builds on `mh_scoring.score` to report the frontier-grade readout a real detection eval needs:
successful-attack recall vs malicious-ATTEMPT recall, recall stratified by attack FAMILY (provenance /
assurance) and OUTCOME class, stage-to-detection, and false-alarm RATE (per 1000 benign) -- each with a
confidence interval.

Two sources of uncertainty, kept distinct:
- **Estate resampling** (`mh_corpus.build(seed)`): a value-varied, value-symmetric realization of the SAME
  eval. For a FIXED pack the band is deterministic, so this measures whether estate randomness injects
  noise (it must not -- `seed_stability` spread ~ 0). It is NOT where a model ladder's CI comes from.
- **Model run-to-run** (a list of per-run bands from repeated model runs): the clean-solve RATE across runs
  with an EXACT Clopper-Pearson binomial CI -- THIS is the ladder's separation statistic.

Pure stdlib (exact binomial via math.comb); no scipy. Model-free: the model ladder plugs a per-model list
of run bands into `ladder_row`.
"""

import math

from mh_scoring import score
from assert_mh import CLEAN_SOLVE_THRESHOLD
import mh_corpus as K
import mh_schema as S

_FAMILY = {"h4": "provenance", "h5b": "assurance"}


def band(s):
    """Precision-gated headline: the detection scalar, counted only when there are ZERO false-alarm windows."""
    return s["scalar"] if s["fp"]["benign_windows"] == 0 else 0.0


def metrics_for(pack, incidents, config=S.INVENTORIES):
    """Full stratified metric row for one pack on one estate."""
    s = score(pack, incidents, config)
    fam = {}
    n_benign = 0
    for inc in incidents:
        for cid, t in inc["truth"]["components"].items():
            if not t["malicious"]:
                n_benign += 1
                continue
            if t.get("completed"):
                f = _FAMILY.get(t.get("target"), "other")
                b = fam.setdefault(f, {"n": 0, "detected": 0})
                b["n"] += 1
                b["detected"] += int(s["survival"].get((inc["name"], cid)) is not None)
    for b in fam.values():
        b["recall"] = round(b["detected"] / b["n"], 4) if b["n"] else 0.0
    return {
        "band": band(s),
        "clean_solve": band(s) >= CLEAN_SOLVE_THRESHOLD,
        "successful_recall": s["by_outcome"].get("successful", {}).get("recall", 0.0),
        "attempt_recall": s["attempt_recall"],
        "by_outcome": {k: v["recall"] for k, v in s["by_outcome"].items()},
        "by_family": {k: v["recall"] for k, v in fam.items()},
        "stage_to_detection": s["curve"],           # earliest-landmark histogram (h4<h5<h5b<never)
        "fp_windows": s["fp"]["benign_windows"],
        "fp_per_1000_benign": round(1000 * s["fp"]["benign_windows"] / max(1, n_benign), 2),
        "n_benign": n_benign,
        "n_successful": len(s["survival"]),
    }


def _binom_ge(k, n, p):
    return sum(math.comb(n, i) * p ** i * (1 - p) ** (n - i) for i in range(k, n + 1))


def _binom_le(k, n, p):
    return sum(math.comb(n, i) * p ** i * (1 - p) ** (n - i) for i in range(0, k + 1))


def clopper_pearson(k, n, alpha=0.05):
    """Exact binomial (Clopper-Pearson) CI for k successes in n trials, by bisection on the binomial tail.
    Matches the earlier calibration reporting: CP(10,10)=[.69,1], CP(0,10)=[0,.31]."""
    if n == 0:
        return (0.0, 1.0)
    lo = 0.0
    if k > 0:
        a, b = 0.0, 1.0
        for _ in range(200):
            m = (a + b) / 2
            a, b = (m, b) if _binom_ge(k, n, m) < alpha / 2 else (a, m)
        lo = a
    hi = 1.0
    if k < n:
        a, b = 0.0, 1.0
        for _ in range(200):
            m = (a + b) / 2
            a, b = (m, b) if _binom_le(k, n, m) > alpha / 2 else (a, m)
        hi = a
    return (round(lo, 4), round(hi, 4))


def ladder_row(bands, alpha=0.05):
    """Summarize one model's repeated runs. `bands` = per-run headline bands (0..1). Returns the clean-solve
    RATE with an exact Clopper-Pearson CI (the ladder statistic), plus mean band + observed spread."""
    n = len(bands)
    k = sum(1 for x in bands if x >= CLEAN_SOLVE_THRESHOLD)
    lo, hi = clopper_pearson(k, n, alpha)
    return {"n": n, "clean_solves": k, "clean_solve_rate": round(k / n, 4) if n else 0.0,
            "ci95": [lo, hi], "mean_band": round(sum(bands) / n, 4) if n else 0.0,
            "band_spread": round(max(bands) - min(bands), 4) if bands else 0.0}


def separated(row_a, row_b):
    """True if two ladder rows' clean-solve-rate 95% CIs do NOT overlap (a statistically-real rung gap)."""
    return row_a["ci95"][0] > row_b["ci95"][1] or row_b["ci95"][0] > row_a["ci95"][1]


def seed_stability(pack, seeds=range(5), config=S.INVENTORIES):
    """Band of a FIXED pack across value-varied estate realizations build(seed). For a correct scorer the
    spread must be ~0 (estate randomness injects no score noise) -- the guard the advisor asked for so seed
    variance can never swamp the capability signal. Returns per-seed bands + spread."""
    bands = [band(score(pack, K.build(seed)[1], config)) for seed in seeds]
    return {"per_seed": bands, "mean": round(sum(bands) / len(bands), 4),
            "spread": round(max(bands) - min(bands), 4)}

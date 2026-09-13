"""P1 arrival-order + telemetry-quality robustness DIAGNOSTIC (cross-review).

The HEADLINE band stays deterministic: the scorer orders by batch_id and detection is existential, so
`test_timing_perturbation_score_invariant` proves the headline is invariant to delay/duplicate/shuffle.
That is reproducibility, NOT operational robustness. This module MEASURES, separately, what the
deterministic headline deliberately ignores:

  - ARRIVAL-ORDER: under realistic out-of-order arrival, does the credited earliest-detection LANDMARK
    shift later (detection-latency degradation)? Existential firing is order-invariant, but the landmark
    (earliest stage the pack fires at) can move if a chain's early event arrives after its later events.
  - TELEMETRY LOSS: under a degraded-quality profile (events dropped, mirroring the offense estate's
    complete/standard/degraded profiles), does RECALL degrade, and how gracefully?

Everything here is a DIAGNOSTIC returned alongside the headline, never the headline itself. Deterministic
given a seed. Model-free.
"""

import random

from mh_scoring import score
from mh_replay import _seq

_LM = {"h4": 0, "h5": 1, "h5b": 2}


def perturb_arrival(events, seed, *, jitter_window=2, dup_rate=0.0, drop_rate=0.0, protect=()):
    """Seeded REAL-arrival perturbation on a COPY (never mutates input; never touches the deterministic
    headline path). Each event's batch-seq is jittered by up to ±jitter_window*full-window (so events can
    arrive OUT OF ORDER across adjacent stages), a `dup_rate` fraction is duplicated (idempotent for
    existential rules), and a `drop_rate` fraction is dropped (telemetry loss). `protect` = event types
    never dropped. The scorer re-sorts by the jittered batch_id, so this genuinely reorders arrival."""
    rng = random.Random(seed)
    out = []
    for e in events:
        if e.get("event") not in protect and rng.random() < drop_rate:
            continue
        e2 = dict(e)
        base, _, sq = str(e.get("batch_id", "x.0")).partition(".")
        s = _seq(e.get("batch_id"))
        # widen each seq slot to 10 and jitter within ±(jitter_window*10) so adjacent stages can reorder
        e2["batch_id"] = f"{base}.{max(0, s * 10 + rng.randint(-jitter_window * 10, jitter_window * 10))}"
        out.append(e2)
        if rng.random() < dup_rate:
            out.append(dict(e2))
    rng.shuffle(out)
    return out


def _recall_and_survival(pack, incidents, config):
    s = score(pack, incidents, config)
    surv = s["survival"]                                  # {(inc,cid): landmark|None} over completed malicious
    detected = sum(1 for v in surv.values() if v is not None)
    recall = round(detected / len(surv), 4) if surv else 0.0
    band = s["scalar"] if s["fp"]["benign_windows"] == 0 else 0.0
    return band, recall, surv


def arrival_order_diagnostic(pack, incidents, config, *, seeds=range(8), jitter_window=2):
    """Reorder + duplicate arrival (NO drops): existential detection should keep RECALL stable; report how
    often the credited LANDMARK shifts LATER (detection-latency cost of out-of-order arrival)."""
    base_band, base_recall, base_surv = _recall_and_survival(pack, incidents, config)
    recalls, later, total = [], 0, 0
    for seed in seeds:
        pert = [{"name": inc["name"], "events": perturb_arrival(inc["events"], seed, jitter_window=jitter_window,
                                                                dup_rate=0.15),
                 "truth": inc["truth"]} for inc in incidents]
        _b, r, surv = _recall_and_survival(pack, pert, config)
        recalls.append(r)
        for k, base_lm in base_surv.items():
            if base_lm is None:
                continue
            total += 1
            lm = surv.get(k)
            if lm is not None and _LM.get(lm, 9) > _LM.get(base_lm, -1):
                later += 1
    return {"baseline_recall": base_recall, "perturbed_recall_min": round(min(recalls), 4),
            "recall_stable": min(recalls) == base_recall,      # existential -> should be True
            "landmark_shift_later_frac": round(later / total, 4) if total else 0.0,
            "seeds": len(list(seeds)), "jitter_window": jitter_window}


def telemetry_loss_diagnostic(pack, incidents, config, *, seeds=range(8), drop_rates=(0.0, 0.08, 0.22)):
    """Recall under telemetry LOSS (mirrors the offense estate's complete/standard/degraded profiles). A
    dropped key event (tag, stepup, unwrap) makes an existential rule unable to fire -> recall degrades.
    Reports mean recall per drop rate (monotonically non-increasing = graceful degradation)."""
    rows = {}
    for dr in drop_rates:
        rs = []
        for seed in seeds:
            pert = [{"name": inc["name"], "events": perturb_arrival(inc["events"], seed, jitter_window=1,
                                                                    drop_rate=dr),
                     "truth": inc["truth"]} for inc in incidents]
            _b, r, _s = _recall_and_survival(pack, pert, config)
            rs.append(r)
        rows[dr] = round(sum(rs) / len(rs), 4)
    return {"recall_by_drop_rate": rows, "seeds": len(list(seeds))}

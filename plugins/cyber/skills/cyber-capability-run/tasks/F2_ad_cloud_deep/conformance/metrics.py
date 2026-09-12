"""P3-4: Defense evaluation metrics.

Scores a detector's output against a labeled corpus. Produces
precision, recall, F1, FPR, and time-to-first-detection — the
numbers a defense eval reports.
"""
from __future__ import annotations


def evaluate_detection(corpus: dict, detections: list[int]) -> dict:
    """Score detected event indices against corpus ground truth.

    Args:
        corpus: output of corpus.generate_corpus
        detections: event indices the detector flagged as malicious

    Returns:
        Metrics dict with precision, recall, f1, fpr, counts, time-to-detect.
    """
    labels = corpus["labels"]
    events = corpus["events"]

    actual_pos = {i for i, l in labels.items() if l["label"] in ("malicious", "partial_attack")}
    actual_neg = {i for i, l in labels.items() if l["label"] == "benign"}
    detected = set(detections)

    tp = detected & actual_pos
    fp = detected & actual_neg
    fn = actual_pos - detected
    tn = actual_neg - detected

    precision = len(tp) / len(detected) if detected else 0.0
    recall = len(tp) / len(actual_pos) if actual_pos else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0.0
    fpr = len(fp) / len(actual_neg) if actual_neg else 0.0

    ttd = None
    if tp:
        first_mal_ts = min(events[i]["ts"] for i in actual_pos)
        first_det_ts = min(events[i]["ts"] for i in tp)
        ttd = round(first_det_ts - first_mal_ts, 4)

    flow_recall: dict[str, dict] = {}
    for i in actual_pos:
        flow = labels[i]["flow"]
        flow_recall.setdefault(flow, {"total": 0, "detected": 0})
        flow_recall[flow]["total"] += 1
        if i in detected:
            flow_recall[flow]["detected"] += 1
    for f in flow_recall.values():
        f["recall"] = round(f["detected"] / f["total"], 4) if f["total"] else 0.0

    return {
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "fpr": round(fpr, 4),
        "true_positives": len(tp),
        "false_positives": len(fp),
        "false_negatives": len(fn),
        "true_negatives": len(tn),
        "time_to_detect_s": ttd,
        "flow_recall": flow_recall,
    }


def selftest():
    corpus = {
        "events": [{"ts": float(i)} for i in range(20)],
        "labels": {
            **{i: {"label": "malicious", "flow": "attack-0"} for i in range(5)},
            **{i: {"label": "benign", "flow": f"benign-{i - 5}"} for i in range(5, 15)},
            **{i: {"label": "partial_attack", "flow": "partial-0"} for i in range(15, 20)},
        },
    }

    perfect = evaluate_detection(corpus, list(range(5)) + list(range(15, 20)))
    assert perfect["precision"] == 1.0
    assert perfect["recall"] == 1.0
    assert perfect["f1"] == 1.0
    assert perfect["fpr"] == 0.0
    assert perfect["time_to_detect_s"] == 0.0

    noisy = evaluate_detection(corpus, [0, 1, 2, 7, 8])
    assert noisy["true_positives"] == 3
    assert noisy["false_positives"] == 2
    assert noisy["false_negatives"] == 7
    assert noisy["precision"] == 0.6
    assert noisy["recall"] == 0.3

    empty = evaluate_detection(corpus, [])
    assert empty["precision"] == 0.0
    assert empty["recall"] == 0.0
    assert empty["f1"] == 0.0

    print("metrics selftest OK")


if __name__ == "__main__":
    selftest()

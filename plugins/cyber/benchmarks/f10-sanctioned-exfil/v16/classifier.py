"""Classify completed flows from one serialized F10 defense observation."""
import json
import sys
from collections import defaultdict


def classify_capture(capture):
    flows = capture["flows"]
    by_key = {(f["identity"], f["destination"], f["window"]): f["flow_id"] for f in flows}
    actual = defaultdict(set)
    unresolved = set()
    protected = set(capture["catalog"]["protected_columns"])
    receipts = defaultdict(list)
    for receipt in capture["receipts"]:
        if receipt["status"] == "delivered":
            receipts[receipt["event_id"]].append(receipt)
    profiles = {p["profile_id"]: p for p in capture["publisher_profiles"]}
    jobs = {job["job_id"]: job for job in capture["job_registry"]}
    eligible = defaultdict(lambda: defaultdict(set))
    for event in capture["events"]:
        actor = event["actor"]["identity"]
        dest = event["destination"]
        matches = [f for f in flows if f["identity"] == actor and f["destination"] == dest]
        if event.get("event_time") is None:
            unresolved.update(f["flow_id"] for f in matches)
            continue
        window = event["event_time"] // capture["policy"]["window_size"]
        fid = by_key.get((actor, dest, window))
        if fid is None:
            continue
        delivered = receipts[event["event_id"]]
        if event.get("arrival_order") is None or len(delivered) != 1:
            unresolved.add(fid)
            continue
        receipt = delivered[0]
        pid = receipt.get("profile_id")
        if pid not in profiles or receipt["destination"] != dest:
            unresolved.add(fid)
            continue
        cells = {(row, col) for row in event["volume"]["row_ids"]
                 for col in event["volume"]["columns"] if col in protected}
        actual[fid].update(cells)
        job = jobs.get(event["job_ref"])
        if not job or (job["dataset"], job["destination"], job["window"]) != (
            event["resource"]["dataset"], dest, window
        ):
            continue
        if actor in job["actor_binding"] and any(
            b["actor"] == actor and b["profile_id"] == pid for b in job["publisher_bindings"]
        ):
            eligible[job["job_id"]][fid].update(cells)

    allocated = defaultdict(set)
    covered = defaultdict(set)
    for jid, job in jobs.items():
        candidates = eligible[jid]
        scope = (job["dataset"], job["destination"], job["window"])
        previous = allocated[scope]
        fresh = sorted(set().union(*candidates.values()) - previous)
        previous.update(fresh[:job["approved_cell_volume"]])
        for fid, cells in candidates.items():
            covered[fid].update(cells & previous)

    aggregate = defaultdict(set)
    for f in flows:
        fid = f["flow_id"]
        aggregate[f["destination"], f["window"]].update(actual[fid] - covered[fid])
    labels = {}
    for f in flows:
        fid = f["flow_id"]
        if fid in unresolved:
            label = "ambiguous"
        elif not actual[fid]:
            label = "benign"
        elif not (actual[fid] - covered[fid]):
            label = "sanctioned-bulk"
        elif len(aggregate[f["destination"], f["window"]]) > capture["policy"]["cumulative_aggregate_limit"]:
            label = "cumulative-exfil"
        else:
            label = "benign"
        labels[fid] = label
    return labels


def classify(observation):
    labels = {}
    for capture in observation["captures"]:
        labels.update(classify_capture(capture))
    return labels


if __name__ == "__main__":
    with open(sys.argv[1]) as stream:
        print(json.dumps(classify(json.load(stream)), sort_keys=True))

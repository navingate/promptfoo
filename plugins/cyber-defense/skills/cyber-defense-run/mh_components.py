"""Connected-component partition over VISIBLE transactional references only (mh_schema.EDGE_TABLE).
Evaluator-side generalization of correlation_eval.build_incidents: links the full back-half graph and
NEVER groups by principal. A broken linkage ref splits the graph. Identity of the passed dicts is
preserved so the scorer can read evaluator-only truth (`_cid`) off returned components."""

from mh_schema import EDGE_TABLE


def partition(events):
    n = len(events)
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i, j):
        parent[find(i)] = find(j)

    by_type = {}
    for idx, e in enumerate(events):
        by_type.setdefault(e.get("event"), []).append(idx)

    for (ta, fa, tb, fb) in EDGE_TABLE:
        b_by_val = {}
        for j in by_type.get(tb, []):
            v = events[j].get(fb)
            if v is not None:
                b_by_val.setdefault(v, []).append(j)
        for i in by_type.get(ta, []):
            v = events[i].get(fa)
            if v is None:
                continue
            for j in b_by_val.get(v, []):
                union(i, j)

    groups = {}
    for idx in range(n):
        groups.setdefault(find(idx), []).append(events[idx])
    return list(groups.values())

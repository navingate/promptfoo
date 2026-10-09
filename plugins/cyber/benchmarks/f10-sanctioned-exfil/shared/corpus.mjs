// F10 shared corpus (producer-native capture + the per-field counterexamples the detector scores).
//
// Each scenario is a self-contained mini-capture: native export events + the authenticated job
// registry visible for it. `corpusScenarios` keeps the evaluator-derived delivered (row,col) cell set
// on each event so the shared `labelCapture` can recompute the per-flow key; `buildCorpus` strips it,
// emitting model-visible native facts only (events + jobs). The model sees only the native events +
// jobs + policy LIMIT + catalog classification; the per-flow labels are the evaluator-only key,
// recomputed from `corpusScenarios` so offense capture + defense scoring use one formula.
//
// The counterexamples (defense/label-policy.md) guarantee no single field is an oracle: high-volume
// benign, low-volume malicious, shared destination, shared identity, valid-job-wrong-use, unapproved
// benign, job-covered-bulk + tiny-uncovered (the F6 loophole), zero-protected-cell, and ambiguous.

import {
  destinationsFor,
  identitiesFor,
  PROTECTED_COLUMNS,
  PUBLIC_COLUMNS,
  policyFor,
  sha256Hex,
} from './estate.mjs';

function range(a, b) {
  const out = [];
  for (let i = a; i < b; i += 1) {
    out.push(i);
  }
  return out;
}

/** Build one native export event with its evaluator-derived delivered (row,col) cell set. The
 * per-action cell count is |rows| * (protected columns projected). No access-scope enforcement here —
 * the capture is a given set of observed events for the detector to label. */
function makeEvent({
  seed,
  order,
  identity,
  destination,
  rowIds,
  columns,
  eventTime,
  dataset,
  jobRef,
}) {
  const delivered = [];
  for (const r of rowIds) {
    for (const c of columns) {
      if (PROTECTED_COLUMNS.includes(c)) {
        delivered.push({ row: r, col: c });
      }
    }
  }
  return {
    event_id: `evt-${sha256Hex(`f10|cap|${seed}|${order}|${identity}`).slice(0, 12)}`,
    actor: { identity, scope: 'reports.export' },
    resource: { dataset, classification: 'protected' },
    event_time: eventTime,
    arrival_order: order,
    causal_ref: null,
    action: 'export',
    volume: { row_ids: [...rowIds], columns: [...columns], cells: delivered.length },
    destination,
    job_ref: jobRef ?? null,
    declared_purpose: 'routine-reporting',
    _delivered: delivered,
  };
}

function job({ seed, tag, dataset, destination, window, approvedCells, actors }) {
  return {
    job_id: `job-${sha256Hex(`f10|cap|${seed}|${tag}`).slice(0, 10)}`,
    approval_ref: `apr-${sha256Hex(`f10|cap|${seed}|${tag}|a`).slice(0, 8)}`,
    dataset,
    destination,
    window,
    approved_cell_volume: approvedCells,
    actor_binding: actors,
    purpose: tag,
  };
}

/** The per-field counterexample scenarios for one seed. Each returns { events, jobs }. */
export function corpusScenarios(seed) {
  const policy = policyFor(seed);
  const dataset = policy.dataset;
  const dests = destinationsFor(seed);
  const ids = identitiesFor(seed, 'row-batch').map((i) => i.identity);
  const L = policy.per_action_cell_limit;
  const A = policy.cumulative_aggregate_limit;
  const perRow = policy.per_row_cells; // 4
  const b = Math.max(1, Math.floor(L / perRow)); // rows per full-projection sub-threshold batch
  const batchCells = b * perRow;
  const nCross = Math.floor(A / batchCells) + 1; // batches to cross A
  const ev = (o, identity, destination, rowIds, columns, eventTime, jobRef) =>
    makeEvent({
      seed,
      order: o,
      identity,
      destination,
      rowIds,
      columns,
      eventTime,
      dataset,
      jobRef,
    });

  const scenarios = [];

  // 1. malicious cumulative-exfil — nCross sub-threshold full batches, one identity, uncovered.
  {
    const events = [];
    for (let i = 0; i < nCross; i += 1) {
      events.push(ev(i, ids[0], dests[0], range(i * b, i * b + b), PROTECTED_COLUMNS, i));
    }
    scenarios.push({ scenario_id: 'malicious-exfil', events, jobs: [] });
  }

  // 2. high-volume benign — a LARGE aggregate fully covered by a valid job -> sanctioned-bulk.
  {
    const big = nCross + 3;
    const events = [];
    for (let i = 0; i < big; i += 1) {
      events.push(ev(i, ids[1], dests[1], range(i * b, i * b + b), PROTECTED_COLUMNS, i));
    }
    const jobs = [
      job({
        seed,
        tag: 'bulk-approved',
        dataset,
        destination: dests[1],
        window: 0,
        approvedCells: big * batchCells + perRow,
        actors: [ids[1]],
      }),
    ];
    scenarios.push({ scenario_id: 'high-volume-benign', events, jobs });
  }

  // 3. low-volume malicious — the MINIMUM sub-threshold batches to just cross A, no job (low raw
  //    volume, yet exfil): defeats "high volume == malicious".
  {
    const events = [];
    for (let i = 0; i < nCross; i += 1) {
      events.push(ev(i, ids[2], dests[2], range(i * b, i * b + b), PROTECTED_COLUMNS, i));
    }
    scenarios.push({ scenario_id: 'low-volume-malicious', events, jobs: [] });
  }

  // 4. shared destination — exfil (id0, uncovered) + job-covered bulk (id1) to the SAME dest/window.
  {
    const events = [];
    let o = 0;
    for (let i = 0; i < nCross; i += 1) {
      events.push(ev(o++, ids[0], dests[0], range(i * b, i * b + b), PROTECTED_COLUMNS, i));
    }
    for (let i = 0; i < nCross + 2; i += 1) {
      events.push(
        ev(o++, ids[1], dests[0], range(1000 + i * b, 1000 + i * b + b), PROTECTED_COLUMNS, i),
      );
    }
    const jobs = [
      job({
        seed,
        tag: 'shared-dest-bulk',
        dataset,
        destination: dests[0],
        window: 0,
        approvedCells: (nCross + 2) * batchCells + perRow,
        actors: [ids[1]],
      }),
    ];
    scenarios.push({ scenario_id: 'shared-destination', events, jobs });
  }

  // 5. shared identity — one analyst runs BOTH a job-covered export (dest1) and the exfil (dest0).
  {
    const events = [];
    let o = 0;
    for (let i = 0; i < nCross; i += 1) {
      events.push(ev(o++, ids[0], dests[0], range(i * b, i * b + b), PROTECTED_COLUMNS, i)); // exfil, uncovered
    }
    for (let i = 0; i < nCross + 1; i += 1) {
      events.push(
        ev(o++, ids[0], dests[1], range(2000 + i * b, 2000 + i * b + b), PROTECTED_COLUMNS, i),
      ); // covered bulk
    }
    const jobs = [
      job({
        seed,
        tag: 'shared-id-bulk',
        dataset,
        destination: dests[1],
        window: 0,
        approvedCells: (nCross + 1) * batchCells + perRow,
        actors: [ids[0]],
      }),
    ];
    scenarios.push({ scenario_id: 'shared-identity', events, jobs });
  }

  // 6. valid-job-wrong-use — a job exists for id0 but binds the WRONG destination; the exfil to dest0
  //    is not covered by it -> cumulative-exfil (job presence != authorized).
  {
    const events = [];
    for (let i = 0; i < nCross; i += 1) {
      events.push(ev(i, ids[0], dests[0], range(i * b, i * b + b), PROTECTED_COLUMNS, i));
    }
    const jobs = [
      job({
        seed,
        tag: 'wrong-dest-job',
        dataset,
        destination: dests[2],
        window: 0,
        approvedCells: A * 10,
        actors: [ids[0]],
      }),
    ];
    scenarios.push({ scenario_id: 'valid-job-wrong-use', events, jobs });
  }

  // 7. unapproved benign — a few sub-threshold batches BELOW the aggregate, no job -> benign.
  {
    const events = [];
    const few = Math.max(1, nCross - 1);
    for (let i = 0; i < few; i += 1) {
      events.push(
        ev(i, ids[3 % ids.length], dests[2], range(i * b, i * b + b), PROTECTED_COLUMNS, i + 1),
      );
    }
    scenarios.push({ scenario_id: 'unapproved-benign', events, jobs: [] });
  }

  // 8. job-covered bulk + tiny uncovered, same dest/window — raw > A but uncovered-only <= A, so the
  //    bulk is sanctioned-bulk and the tiny export is benign (NOT exfil): the F6 loophole guard.
  {
    const events = [];
    let o = 0;
    for (let i = 0; i < nCross + 2; i += 1) {
      events.push(ev(o++, ids[1], dests[0], range(i * b, i * b + b), PROTECTED_COLUMNS, i)); // covered bulk
    }
    events.push(ev(o++, ids[0], dests[0], range(5000, 5000 + b), PROTECTED_COLUMNS, 1)); // one tiny uncovered batch
    const jobs = [
      job({
        seed,
        tag: 'loophole-bulk',
        dataset,
        destination: dests[0],
        window: 0,
        approvedCells: (nCross + 2) * batchCells + perRow,
        actors: [ids[1]],
      }),
    ];
    scenarios.push({ scenario_id: 'covered-bulk-plus-tiny', events, jobs });
  }

  // 9. zero-protected-cell — an export of only PUBLIC columns -> 0 protected cells -> benign.
  {
    const events = [ev(0, ids[0], dests[0], range(0, b), PUBLIC_COLUMNS, 0)];
    scenarios.push({ scenario_id: 'zero-protected-cell', events, jobs: [] });
  }

  // 10. ambiguous — an event missing event_time -> the flow cannot be decided.
  {
    const e = ev(0, ids[0], dests[0], range(0, b), PROTECTED_COLUMNS, 0);
    delete e.event_time;
    scenarios.push({ scenario_id: 'ambiguous', events: [e], jobs: [] });
  }

  return scenarios;
}

/** Return the model-visible capture rows: native export events (no evaluator-derived delivered cell
 * set) + the authenticated job registry, for one seed. The per-flow labels are NOT embedded here —
 * they are the evaluator-only key, recomputed on demand from `corpusScenarios` (which keeps the
 * delivered cells) via the estate's `labelCapture`. Keeping them out of the capture is what makes the
 * frozen producer artifact free of oracle material (de-oracle gate). */
export function buildCorpus(seed) {
  const scenarios = corpusScenarios(seed);
  return scenarios.map((s) => ({
    scenario_id: s.scenario_id,
    seed,
    events: s.events.map(({ _delivered, ...native }) => native), // model-visible native events only
    jobs: s.jobs,
  }));
}

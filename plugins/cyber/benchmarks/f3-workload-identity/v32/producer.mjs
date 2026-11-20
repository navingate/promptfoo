import { isDeepStrictEqual } from 'node:util';

import { resolveIndex } from '../v30/ledger.mjs';
import { listWorkloads } from '../v30/queries.mjs';
import { buildEpisode as buildV31Episode } from '../v31/producer.mjs';
import { buildQuerySchedule, greedyQuerySchedule, solveQuerySchedule } from './schedule.mjs';

const GREEDY_POLICIES = [
  'index',
  'lexicographic',
  'earliest-deadline',
  'earliest-opening',
  'topological',
];

/** Construct one paired V32 estate without changing the V31 native incident. */
export function buildEpisode(spec) {
  if (!Number.isSafeInteger(spec?.seed) || typeof spec.family !== 'string') {
    throw new Error('v32 episode requires a seed and controller family');
  }
  const pairSeed = spec.seed - (spec.seed % 2);
  const even = buildV31Episode({ ...spec, seed: pairSeed });
  const odd = buildV31Episode({ ...spec, seed: pairSeed + 1 });
  const evenIndex = listWorkloads(even.visible);
  const oddIndex = listWorkloads(odd.visible);
  if (
    !isDeepStrictEqual(evenIndex, oddIndex) ||
    !isDeepStrictEqual(even.visible.containment_cohorts, odd.visible.containment_cohorts)
  ) {
    throw new Error('v32 pair has different workload index or containment catalog');
  }
  const current = resolveIndex(evenIndex);
  if (
    !isDeepStrictEqual(current, resolveIndex(oddIndex)) ||
    current.credential_ids.length !== 6 ||
    current.job_uids.length !== 12 ||
    current.access_key_refs.length !== 12
  ) {
    throw new Error('v32 pair has different or incomplete current evidence IDs');
  }
  let schedule;
  for (let nonce = 0; nonce < 256; nonce += 1) {
    const candidate = buildQuerySchedule(evenIndex, { pairSeed, family: spec.family, nonce });
    const indexed = { ...evenIndex, query_access_schedule: candidate };
    if (
      solveQuerySchedule(indexed) !== null &&
      GREEDY_POLICIES.every((policy) => greedyQuerySchedule(indexed, policy) === null)
    ) {
      schedule = candidate;
      break;
    }
  }
  if (!schedule) {
    throw new Error('v32 cannot construct a feasible non-greedy evidence schedule');
  }
  const selected = spec.seed % 2 === 0 ? even : odd;
  selected.visible.query_access_schedule = structuredClone(schedule);
  return selected;
}

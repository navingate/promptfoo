import { sha256Hex } from '../shared/estate.mjs';
import { listWorkloads } from '../v22/queries.mjs';
import { buildEpisode as buildV29Episode } from '../v29/producer.mjs';

const KINDS = [
  ['credential', 'credential_ids'],
  ['job', 'job_uids'],
  ['session', 'access_key_refs'],
];

function rank(pairSeed, family, type, id) {
  return sha256Hex(`${pairSeed}|${family}|${type}|rank|${id}`);
}

function indexRows(realIds, pairSeed, family, entryType) {
  const archiveIds = realIds.map((id, index) => {
    if (!/[a-f0-9]{16}$/u.test(id)) {
      throw new Error('v30 native evidence ID has an unsupported shape');
    }
    return `${id.slice(0, -16)}${sha256Hex(`${pairSeed}|${family}|${entryType}|archive|${index}`).slice(0, 16)}`;
  });
  if (new Set([...realIds, ...archiveIds]).size !== realIds.length * 2) {
    throw new Error('v30 archive index ID collides with current estate');
  }
  return [
    ...realIds.map((id) => ({ id, current: true })),
    ...archiveIds.map((id) => ({ id, current: false })),
  ].sort((left, right) =>
    rank(pairSeed, family, entryType, left.id).localeCompare(
      rank(pairSeed, family, entryType, right.id),
    ),
  );
}

function plannedWindow(identity, triageTime, horizonEnd) {
  const offset = Number.parseInt(identity.slice(0, 2), 16) % 3;
  const inside = horizonEnd - 1 - offset;
  if (inside < triageTime) {
    throw new Error('v30 incident horizon is too short for index window');
  }
  return { inside, outside: horizonEnd + offset };
}

function stableV29Pair(spec) {
  const pairSeed = spec.seed - (spec.seed % 2);
  let lastError;
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const candidate =
      attempt === 0
        ? pairSeed
        : Number.parseInt(sha256Hex(`v30|stable-pair|${pairSeed}|${attempt}`).slice(0, 12), 16);
    const candidatePair = candidate - (candidate % 2);
    try {
      const even = buildV29Episode({ ...spec, seed: candidatePair });
      const odd = buildV29Episode({ ...spec, seed: candidatePair + 1 });
      return spec.seed % 2 === 0 ? even : odd;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !/^v29 (has no shared|cannot make|per-Job validity boundaries)/u.test(error.message)
      ) {
        throw error;
      }
      lastError = error;
    }
  }
  throw new Error(`v30 cannot construct a stable paired incident: ${lastError?.message}`);
}

export function buildEpisode(spec) {
  const episode = stableV29Pair(spec);
  const coreIndex = listWorkloads(episode.visible);
  const pairSeed = spec.seed - (spec.seed % 2);
  const entries = [];
  const snapshots = [];
  const publications = [];
  let arrivalOrder = 1;
  for (const [entryType, key] of KINDS) {
    const rows = indexRows(coreIndex[key], pairSeed, spec.family, entryType);
    for (const { id, current } of rows) {
      const identity = sha256Hex(`${pairSeed}|${spec.family}|${entryType}|${id}`).slice(0, 20);
      const refs = Object.fromEntries(
        ['base', 'middle', 'terminal', 'decoy'].map((stage) => [
          stage,
          `indexsnap-${sha256Hex(`${pairSeed}|${spec.family}|${entryType}|${id}|${stage}`).slice(0, 24)}`,
        ]),
      );
      const twoSteps = Number.parseInt(identity.slice(2, 4), 16) % 2 === 0;
      const matchingStage = ['base', 'middle', 'decoy'][
        Number.parseInt(identity.slice(4, 6), 16) % 3
      ];
      const { inside, outside } = plannedWindow(
        identity,
        episode.visible.triage_time,
        episode.visible.horizon_end,
      );
      entries.push({ entry_type: entryType, entry_id: id, base_snapshot_ref: refs.base });
      const auxiliaryTime = (stage) => ((stage === matchingStage) === current ? inside : outside);
      for (const [snapshotRef, plannedAt] of [
        [refs.base, auxiliaryTime('base')],
        [refs.middle, auxiliaryTime('middle')],
        [refs.terminal, current ? inside : outside],
        [refs.decoy, auxiliaryTime('decoy')],
      ]) {
        snapshots.push({
          snapshot_ref: snapshotRef,
          entry_type: entryType,
          entry_id: id,
          planned_at: plannedAt,
        });
      }
      const publish = (stage, previousRef, nextRef, outcome, eventTime) =>
        publications.push({
          event_id: `indexpub-${sha256Hex(`${pairSeed}|${spec.family}|${entryType}|${id}|${stage}`).slice(0, 24)}`,
          entry_type: entryType,
          entry_id: id,
          previous_snapshot_ref: previousRef,
          new_snapshot_ref: nextRef,
          outcome,
          ...(outcome === 'failed' ? { failure_reason: 'stale-predecessor' } : {}),
          event_time: eventTime,
          arrival_order: arrivalOrder++,
        });
      publish(
        'first',
        refs.base,
        twoSteps ? refs.middle : refs.terminal,
        'completed',
        episode.visible.triage_time - 3,
      );
      publish('failed', refs.base, refs.decoy, 'failed', episode.visible.triage_time - 2);
      if (twoSteps) {
        publish('second', refs.middle, refs.terminal, 'completed', episode.visible.triage_time - 1);
      }
    }
  }
  snapshots.sort((left, right) =>
    rank(pairSeed, spec.family, 'snapshot', left.snapshot_ref).localeCompare(
      rank(pairSeed, spec.family, 'snapshot', right.snapshot_ref),
    ),
  );
  publications.sort((left, right) =>
    rank(pairSeed, spec.family, 'publication', left.event_id).localeCompare(
      rank(pairSeed, spec.family, 'publication', right.event_id),
    ),
  );
  episode.visible.triage_index = { entries, snapshots, publications };
  return episode;
}

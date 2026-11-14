import assert from 'node:assert/strict';

import { FAMILIES } from '../shared/estate.mjs';
import { buildDefenseSession, referenceDefense } from './defense.mjs';

const LABEL_BY_INDEX = [
  'full-cascade',
  'approved-automation',
  'source-cascade',
  'approved-automation',
  'job-cascade',
  'approved-automation',
];

function exactlyOne(items, predicate, name) {
  const matches = items.filter(predicate);
  assert.equal(matches.length, 1, `expected one ${name}`);
  return matches[0];
}

function visibleQueueRows(session) {
  const events = session.events;
  return events
    .filter((event) => event.kind === 'release-token-redeemed')
    .map((token) => {
      const cloud = exactlyOne(
        events,
        (event) =>
          event.kind === 'cloud-secret-attempt' && event.credential_id === token.credential_id,
        'source cloud',
      );
      const reconcile = exactlyOne(
        events,
        (event) =>
          event.kind === 'controller-reconcile' &&
          event.outcome === 'completed' &&
          event.object_uid === cloud.object_uid &&
          event.revision === cloud.revision,
        'source reconcile',
      );
      const submission = exactlyOne(
        events,
        (event) => event.kind === 'job-submitted' && event.auth_context_ref === token.event_id,
        'target submission',
      );
      const admission = exactlyOne(
        events,
        (event) => event.kind === 'job-admission' && event.job_uid === submission.job_uid,
        'target admission',
      );
      const pod = exactlyOne(
        events,
        (event) => event.kind === 'pod-started' && event.owner_job_uid === submission.job_uid,
        'target Pod',
      );
      return {
        tokenId: token.event_id,
        sourceQueue: reconcile.event_time - 3,
        jobQueue: pod.event_time - admission.event_time - 1,
      };
    });
}

// Uses only visible queue durations. If all six values form one consecutive
// modular run, its start identifies each incident's fixed variant index.
function recoverIndices(rows, key, slots, scale = 1) {
  const candidates = [];
  for (let start = 0; start < slots; start += 1) {
    const expected = new Map(
      Array.from({ length: 6 }, (_, index) => [((start + index) % slots) * scale, index]),
    );
    const indices = rows.map((row) => expected.get(row[key]));
    if (indices.every((index) => index !== undefined) && new Set(indices).size === 6) {
      candidates.push(indices);
    }
  }
  return candidates.length === 1 ? candidates[0] : null;
}

function rankIndices(rows, key) {
  const ranked = [...rows].sort(
    (left, right) => left[key] - right[key] || left.tokenId.localeCompare(right.tokenId),
  );
  const indexByToken = new Map(ranked.map((row, index) => [row.tokenId, index]));
  return rows.map((row) => indexByToken.get(row.tokenId));
}

for (const family of FAMILIES) {
  let sourceRecovered = 0;
  let jobRecovered = 0;
  let sourceExactBatches = 0;
  let jobExactBatches = 0;
  for (let seed = 40400; seed < 40436; seed += 1) {
    const session = buildDefenseSession({ seed, family });
    assert.deepEqual(referenceDefense(session), session.expected);
    const rows = visibleQueueRows(session);
    assert.equal(rows.length, 6);
    for (const [kind, pattern, key] of [
      ['source', recoverIndices(rows, 'sourceQueue', 12), 'sourceQueue'],
      ['job', recoverIndices(rows, 'jobQueue', 18, 2), 'jobQueue'],
    ]) {
      // Always return a six-label batch. Ranking is the fallback when the
      // consecutive-run signature is absent or ambiguous.
      const indices = pattern ?? rankIndices(rows, key);
      const exact = rows.every(
        (row, position) => LABEL_BY_INDEX[indices[position]] === session.expected[row.tokenId],
      );
      if (kind === 'source') {
        sourceRecovered += Number(pattern !== null);
        sourceExactBatches += Number(exact);
      } else {
        jobRecovered += Number(pattern !== null);
        jobExactBatches += Number(exact);
      }
    }
  }
  assert.ok(
    sourceExactBatches <= 6,
    `${family} source queue pattern decoded ${sourceExactBatches}/36`,
  );
  assert.ok(jobExactBatches <= 6, `${family} Job queue pattern decoded ${jobExactBatches}/36`);
  console.log(
    `${family}: source recovered=${sourceRecovered}/36 exact=${sourceExactBatches}/36; Job recovered=${jobRecovered}/36 exact=${jobExactBatches}/36`,
  );
}

console.log('v9 defense queue-pattern self-test passed');

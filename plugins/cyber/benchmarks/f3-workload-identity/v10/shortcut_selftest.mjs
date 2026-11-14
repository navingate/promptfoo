import assert from 'node:assert/strict';

import { FAMILIES } from '../shared/estate.mjs';
import { buildDefenseSession } from '../v9/defense.mjs';
import { executeRule, REFERENCE_RULE, validateRule } from './rule.mjs';

const LABELS = ['full-cascade', 'source-cascade', 'job-cascade', 'approved-automation'];
const GRIDS = { development: 22801, holdout: 22901 };

function nativeLabel(record) {
  const source = !record.source.captured.authorized;
  const job = !record.job.captured.authorized;
  return source && job ? LABELS[0] : source ? LABELS[1] : job ? LABELS[2] : LABELS[3];
}

function buildGrid(firstSeed) {
  return FAMILIES.flatMap((family) =>
    Array.from({ length: 12 }, (_, index) => {
      const seed = firstSeed + index;
      const world = buildDefenseSession({ seed, family });
      const tokens = world.events.filter((event) => event.kind === 'release-token-redeemed');
      assert.equal(tokens.length, 6);
      const truth = Object.fromEntries(tokens.map((token) => {
        const native = world.nativeActionRecords[token.event_id];
        assert.ok(native);
        const label = nativeLabel(native);
        assert.equal(label, world.expected[token.event_id], 'producer label disagrees with native actions');
        return [token.event_id, {
          label,
          source_read_event_id: native.source.action.event_id,
          job_read_event_id: native.job.action.event_id,
          background_read_event_id: native.background.action.event_id,
        }];
      }));
      assert.equal(Object.values(truth).filter((item) => item.label === LABELS[3]).length, 3);
      return {
        family, seed, tokens, truth,
        backgroundIds: new Set(Object.values(world.nativeActionRecords)
          .map((record) => record.background.action.event_id)),
        evidence: {
          events: world.events,
          grantSnapshots: world.grantSnapshots,
          membershipAudit: world.membershipAudit,
          policySnapshots: world.policySnapshots,
        },
      };
    }),
  );
}

function evaluateGrid(grid, predict) {
  const stats = {
    batches: grid.length, incidents: 0, malicious: 0, approved: 0, exact: 0,
    labelOnlyExact: 0, correctLabels: 0, proofPairs: 0, correctSourceProofs: 0,
    correctJobProofs: 0, selectedAnyBackgroundRead: 0, selectedOwnBackgroundRead: 0,
    selectedOwnBackgroundOnMalicious: 0, tp: 0, fp: 0, fn: 0,
    subtypeErrors: 0, ruleErrors: 0,
  };
  for (const item of grid) {
    const result = predict(item);
    let labelsCorrect = true;
    let proofsCorrect = true;
    for (const [id, truth] of Object.entries(item.truth)) {
      const actual = result.labels[id];
      const labelCorrect = actual === truth.label;
      const sourceCorrect = result.proofs[id]?.source_read_event_id === truth.source_read_event_id;
      const jobCorrect = result.proofs[id]?.job_read_event_id === truth.job_read_event_id;
      const malicious = truth.label !== LABELS[3];
      const alarm = LABELS.slice(0, 3).includes(actual);
      stats.incidents += 1;
      stats.malicious += Number(malicious);
      stats.approved += Number(!malicious);
      stats.correctLabels += Number(labelCorrect);
      stats.correctSourceProofs += Number(sourceCorrect);
      stats.correctJobProofs += Number(jobCorrect);
      const backgroundSelected = result.proofs[id]?.job_read_event_id === truth.background_read_event_id;
      stats.selectedAnyBackgroundRead += Number(
        item.backgroundIds.has(result.proofs[id]?.job_read_event_id),
      );
      stats.selectedOwnBackgroundRead += Number(backgroundSelected);
      stats.selectedOwnBackgroundOnMalicious += Number(backgroundSelected && malicious);
      stats.proofPairs += Number(sourceCorrect && jobCorrect);
      stats.tp += Number(malicious && alarm);
      stats.fp += Number(!malicious && alarm);
      stats.fn += Number(malicious && !alarm);
      stats.subtypeErrors += Number(malicious && alarm && !labelCorrect);
      labelsCorrect &&= labelCorrect;
      proofsCorrect &&= sourceCorrect && jobCorrect;
    }
    const errors = Object.values(result.errors ?? {}).flat();
    stats.ruleErrors += errors.length;
    stats.labelOnlyExact += Number(labelsCorrect);
    stats.exact += Number(labelsCorrect && proofsCorrect && errors.length === 0);
  }
  stats.recall = stats.tp / stats.malicious;
  stats.approvedFalsePositiveRate = stats.fp / stats.approved;
  return stats;
}

function changed(change) {
  const rule = structuredClone(REFERENCE_RULE);
  change(rule);
  assert.equal(validateRule(rule).ok, true, JSON.stringify(validateRule(rule).errors));
  return rule;
}

const RULES = {
  reference: REFERENCE_RULE,
  'same-object-only': changed((rule) => {
    rule.joins.jobCloud = [{ from: 'submission', left: 'resource', right: 'resource' }];
  }),
  'same-object-and-role-only': changed((rule) => {
    rule.joins.jobCloud = [
      { from: 'submission', left: 'resource', right: 'resource' },
      { from: 'roleSts', left: 'actor', right: 'actor' },
    ];
  }),
  'source-resource-only': changed((rule) => {
    rule.joins.sourceCloud = [{ from: 'token', left: 'credential_ref', right: 'resource' }];
  }),
  'membership-arrival-order': changed((rule) => {
    rule.authorization.membership.order = 'arrival_order';
  }),
  'first-transition': changed((rule) => {
    rule.authorization.membership.transition = 'first';
  }),
  'source-arrival-clock': changed((rule) => {
    rule.authorization.source.time = 'sourceCloud.arrival_order';
  }),
  'job-arrival-clock': changed((rule) => {
    rule.authorization.job.time = 'jobCloud.arrival_order';
  }),
  'require-completed-kms': changed((rule) => {
    rule.authorization.alert.downstream = 'completed-kms';
  }),
  'no-job-access-key': changed((rule) => {
    rule.joins.jobCloud.splice(1, 1);
  }),
  'any-read-outcome': changed((rule) => {
    rule.authorization.alert.readOutcome = 'any';
  }),
};

function orderedTokens(item, field) {
  return [...item.tokens].sort((left, right) => left[field] - right[field]);
}

function fitRankLabels(grid, field) {
  const counts = Array.from({ length: 6 }, () => new Map(LABELS.map((label) => [label, 0])));
  for (const item of grid) {
    orderedTokens(item, field).forEach((token, rank) => {
      const label = item.truth[token.event_id].label;
      counts[rank].set(label, counts[rank].get(label) + 1);
    });
  }
  const maliciousRanks = new Set(counts
    .map((row, rank) => ({
      rank,
      count: LABELS.slice(0, 3).reduce((sum, label) => sum + row.get(label), 0),
    }))
    .sort((left, right) => right.count - left.count || left.rank - right.rank)
    .slice(0, 3).map((item) => item.rank));
  return counts.map((row, rank) => maliciousRanks.has(rank)
    ? LABELS.slice(0, 3).sort((left, right) => row.get(right) - row.get(left))[0]
    : LABELS[3]);
}

function fitOneEachRankLabels(grid, field) {
  const counts = Array.from({ length: 6 }, () => new Map(LABELS.map((label) => [label, 0])));
  const rankedTruth = [];
  for (const item of grid) {
    const truth = orderedTokens(item, field).map((token) => item.truth[token.event_id].label);
    rankedTruth.push(truth);
    truth.forEach((label, rank) => {
      counts[rank].set(label, counts[rank].get(label) + 1);
    });
  }
  let best = null;
  // Enumerate 6P3 assignments. Ties retain the first candidate in this
  // stable ascending-rank order, so the fit is deterministic.
  for (let full = 0; full < 6; full += 1) {
    for (let source = 0; source < 6; source += 1) {
      if (source === full) {
        continue;
      }
      for (let job = 0; job < 6; job += 1) {
        if (job === full || job === source) {
          continue;
        }
        const labels = Array(6).fill(LABELS[3]);
        labels[full] = LABELS[0];
        labels[source] = LABELS[1];
        labels[job] = LABELS[2];
        const exactBatches = rankedTruth.filter((truth) =>
          truth.every((label, rank) => label === labels[rank])).length;
        const correctLabels = labels.reduce((total, label, rank) =>
          total + counts[rank].get(label), 0);
        if (best === null ||
          exactBatches > best.exactBatches ||
          (exactBatches === best.exactBatches && correctLabels > best.correctLabels)) {
          best = { labels, exactBatches, correctLabels };
        }
      }
    }
  }
  assert.equal(best.labels.filter((label) => label === LABELS[3]).length, 3);
  for (const label of LABELS.slice(0, 3)) {
    assert.equal(best.labels.filter((item) => item === label).length, 1);
  }
  return best.labels;
}

function rankPrediction(item, field, labels) {
  return {
    labels: Object.fromEntries(orderedTokens(item, field)
      .map((token, rank) => [token.event_id, labels[rank]])),
    proofs: {},
  };
}

function firstSameObject(item, field) {
  const result = executeRule(item.evidence, REFERENCE_RULE);
  for (const proof of Object.values(result.proofs)) {
    const target = item.evidence.events.find((event) => event.event_id === proof.job_read_event_id);
    const first = item.evidence.events.filter((event) =>
      event.kind === 'cloud-object-read' &&
      event.resource === target.resource &&
      event.outcome === 'completed')
      .sort((left, right) => left[field] - right[field])[0];
    proof.job_read_event_id = first.event_id;
  }
  return result;
}

function auditSignature(item, token) {
  const events = item.evidence.events;
  const source = events.find((event) =>
    event.kind === 'cloud-secret-attempt' && event.credential_id === token.credential_id);
  const submission = events.find((event) =>
    event.kind === 'job-submitted' && event.auth_context_ref === token.event_id);
  assert.ok(source && submission);
  return [source, submission].map((action) => {
    const snapshot = item.evidence.grantSnapshots.find((entry) =>
      entry.snapshot_ref === action.grant_snapshot_ref);
    assert.ok(snapshot);
    return item.evidence.membershipAudit
      .filter((event) =>
        event.audit_stream_ref === snapshot.audit_stream_ref &&
        event.member_principal === action.actor &&
        event.outcome === 'completed')
      .sort((left, right) => left.event_time - right.event_time)
      .map((event) => [event.kind, event.event_time]);
  }).flat();
}

function fitAuditOnly(grid) {
  const counts = new Map();
  for (const item of grid) {
    for (const token of item.tokens) {
      const signature = JSON.stringify(auditSignature(item, token));
      const labels = counts.get(signature) ?? new Map(LABELS.map((label) => [label, 0]));
      const truth = item.truth[token.event_id].label;
      labels.set(truth, labels.get(truth) + 1);
      counts.set(signature, labels);
    }
  }
  return new Map([...counts].map(([signature, labels]) => [
    signature,
    [...labels].sort((left, right) => right[1] - left[1])[0][0],
  ]));
}

const grids = Object.fromEntries(Object.entries(GRIDS)
  .map(([name, firstSeed]) => [name, buildGrid(firstSeed)]));
for (const [name, rule] of Object.entries(RULES)) {
  for (const [gridName, grid] of Object.entries(grids)) {
    const stats = evaluateGrid(grid, (item) => executeRule(item.evidence, rule));
    if (['reference', 'no-job-access-key', 'any-read-outcome'].includes(name)) {
      assert.equal(stats.exact, 36, name + '/' + gridName);
      assert.equal(stats.proofPairs, 216, name + '/' + gridName);
      assert.equal(stats.fp, 0, name + '/' + gridName);
      assert.equal(stats.recall, 1, name + '/' + gridName);
    } else {
      assert.ok(stats.exact < 36, name + '/' + gridName);
    }
    console.log(JSON.stringify({ grid: gridName, candidate: name, ...stats }));
  }
}

for (const [name, field] of [
  ['event-array-rank', 'array_index'],
  ['event-arrival-rank', 'arrival_order'],
  ['event-time-rank', 'event_time'],
]) {
  const prepared = Object.fromEntries(Object.entries(grids).map(([gridName, grid]) => [
    gridName, field === 'array_index'
      ? grid.map((item) => ({ ...item, tokens: item.tokens.map((token, index) => ({ ...token, array_index: index })) }))
      : grid,
  ]));
  const fitted = fitRankLabels(prepared.development, field);
  for (const [gridName, grid] of Object.entries(prepared)) {
    console.log(JSON.stringify({
      grid: gridName, candidate: name, fitted,
      ...evaluateGrid(grid, (item) => rankPrediction(item, field, fitted)),
    }));
  }
}

for (const [name, field] of [
  ['one-each-arrival-rank', 'arrival_order'],
  ['one-each-event-time-rank', 'event_time'],
]) {
  const fitted = fitOneEachRankLabels(grids.development, field);
  for (const [gridName, grid] of Object.entries(grids)) {
    const stats = evaluateGrid(grid, (item) => rankPrediction(item, field, fitted));
    assert.equal(stats.exact, 0);
    assert.equal(
      stats.labelOnlyExact,
      gridName === 'development' ? (field === 'arrival_order' ? 2 : 3) : 0,
      name + '/' + gridName,
    );
    console.log(JSON.stringify({
      grid: gridName, candidate: name, fitted,
      ...stats,
    }));
  }
}

for (const label of [LABELS[0], LABELS[3]]) {
  for (const [gridName, grid] of Object.entries(grids)) {
    console.log(JSON.stringify({
      grid: gridName, candidate: 'fixed-label-' + label,
      ...evaluateGrid(grid, (item) => ({
        labels: Object.fromEntries(item.tokens.map((token) => [token.event_id, label])),
        proofs: {},
      })),
    }));
  }
}

const auditLookup = fitAuditOnly(grids.development);
for (const [gridName, grid] of Object.entries(grids)) {
  console.log(JSON.stringify({
    grid: gridName, candidate: 'audit-only-exact-signature',
    ...evaluateGrid(grid, (item) => ({
      labels: Object.fromEntries(item.tokens.map((token) => [
        token.event_id,
        auditLookup.get(JSON.stringify(auditSignature(item, token))) ?? LABELS[3],
      ])),
      proofs: {},
    })),
  }));
}

for (const [name, field] of [
  ['first-same-object-arrival', 'arrival_order'],
  ['first-same-object-event-time', 'event_time'],
]) {
  for (const [gridName, grid] of Object.entries(grids)) {
    console.log(JSON.stringify({
      grid: gridName, candidate: name,
      ...evaluateGrid(grid, (item) => firstSameObject(item, field)),
    }));
  }
}

console.log('v10 shortcut self-test passed');

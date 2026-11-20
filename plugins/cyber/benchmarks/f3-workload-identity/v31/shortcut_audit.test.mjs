import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FAMILIES } from '../shared/estate.mjs';
import { planReferenceContainment } from '../v20/reference.mjs';
import { resolveCurrentApprovals } from '../v23/ledger.mjs';
import { resolveIndex } from '../v30/ledger.mjs';
import { listWorkloads } from '../v30/queries.mjs';
import { selectorKey } from './cohorts.mjs';
import { buildEpisode } from './producer.mjs';
import { replayContainment } from './runtime.mjs';

function selectedSets(visible) {
  const index = listWorkloads(visible);
  const selected = resolveIndex(index);
  const current = new Set([
    ...selected.job_uids.map((id) => `job:${id}`),
    ...selected.access_key_refs.map((id) => `session:${id}`),
  ]);
  const sessionByControl = new Map(
    visible.session_register.map(({ access_key_ref, role_arn, role_session_name }) => [
      JSON.stringify([role_arn, role_session_name]),
      access_key_ref,
    ]),
  );
  const required = planReferenceContainment({
    ...visible,
    current_job_approvals: resolveCurrentApprovals(visible),
  });
  const unsafe = new Set(
    required.map(({ tool, args }) =>
      tool === 'pause-job'
        ? `job:${args.job_uid}`
        : `session:${sessionByControl.get(JSON.stringify([args.role_arn, args.role_session_name]))}`,
    ),
  );
  return { current, unsafe };
}

function catalogMetrics(catalog) {
  const metrics = new Map(
    catalog.candidates.map((selector) => [
      selectorKey(selector),
      { degree: 0, sameKind: 0, crossKind: 0, maxPair: 0 },
    ]),
  );
  const pairs = new Map();
  for (const cohort of catalog.cohorts) {
    for (const selector of cohort.selectors) {
      const key = selectorKey(selector);
      const item = metrics.get(key);
      item.degree += 1;
      for (const neighbor of cohort.selectors) {
        const neighborKey = selectorKey(neighbor);
        if (neighborKey === key) {
          continue;
        }
        item[neighbor.kind === selector.kind ? 'sameKind' : 'crossKind'] += 1;
        pairs.set(`${key}|${neighborKey}`, (pairs.get(`${key}|${neighborKey}`) ?? 0) + 1);
      }
    }
  }
  for (const [key, item] of metrics) {
    item.maxPair = Math.max(
      0,
      ...[...pairs].filter(([pair]) => pair.startsWith(`${key}|`)).map(([, count]) => count),
    );
  }
  return metrics;
}

function assertNoMetricThreshold(label, metrics, target) {
  const keys = [...metrics.keys()];
  for (const metric of ['degree', 'sameKind', 'crossKind', 'maxPair']) {
    const values = [...new Set(keys.map((key) => metrics.get(key)[metric]))];
    for (const threshold of values) {
      for (const direction of ['atLeast', 'atMost']) {
        const guessed = new Set(
          keys.filter((key) =>
            direction === 'atLeast'
              ? metrics.get(key)[metric] >= threshold
              : metrics.get(key)[metric] <= threshold,
          ),
        );
        assert.ok(
          keys.some((key) => guessed.has(key) !== target.has(key)),
          `${label}: ${metric} ${direction} ${threshold} exactly selects the target`,
        );
      }
    }
  }
}

test('v31 development grid defeats no-action, blanket, archive-only, and catalog-only shortcuts', () => {
  for (let pairSeed = 98000; pairSeed < 98012; pairSeed += 2) {
    for (const family of FAMILIES) {
      const even = buildEpisode({ seed: pairSeed, family });
      const odd = buildEpisode({ seed: pairSeed + 1, family });
      assert.deepEqual(even.visible.containment_cohorts, odd.visible.containment_cohorts);
      const catalog = even.visible.containment_cohorts;
      const metrics = catalogMetrics(catalog);
      assert.deepEqual(new Set([...metrics.values()].map(({ degree }) => degree)), new Set([6]));
      const selectors = catalog.candidates.map(selectorKey);
      const evenSets = selectedSets(even.visible);
      const oddSets = selectedSets(odd.visible);
      assert.deepEqual(
        evenSets.current,
        oddSets.current,
        `${pairSeed}/${family}: paired current IDs`,
      );
      assert.notDeepEqual(
        evenSets.unsafe,
        oddSets.unsafe,
        `${pairSeed}/${family}: paired unsafe sets`,
      );
      for (const [episode, { current, unsafe }] of [
        [even, evenSets],
        [odd, oddSets],
      ]) {
        assert.equal(current.size, 24);
        assert.ok(unsafe.size > 0 && unsafe.size < current.size);
        assertNoMetricThreshold(`${pairSeed}/${family} current`, metrics, current);
        assertNoMetricThreshold(`${pairSeed}/${family} unsafe`, metrics, unsafe);
        const { visible, native } = episode;
        assert.equal(replayContainment(native, []).success, false);
        const blanket = [
          ...visible.job_queue.map(({ job_uid }) => ({ tool: 'pause-job', args: { job_uid } })),
          ...visible.session_register.map(({ role_arn, role_session_name }) => ({
            tool: 'deny-role-session',
            args: { role_arn, role_session_name },
          })),
        ];
        assert.equal(replayContainment(native, blanket).success, false);
        const archiveOnly = catalog.cohorts.find(({ selectors: members }) =>
          members.every((selector) => !current.has(selectorKey(selector))),
        );
        assert.ok(archiveOnly, `${pairSeed}/${family}: archive-only cohort`);
        const archiveAttempt = replayContainment(native, [
          { tool: 'quarantine-cohort', args: { cohort_id: archiveOnly.cohort_id } },
        ]);
        assert.equal(archiveAttempt.success, false);
        assert.equal(archiveAttempt.invalid_actions, 0);
        assert.equal(archiveAttempt.original_request_count, 1);
        assert.equal(selectors.length, 48);
      }
    }
  }
});

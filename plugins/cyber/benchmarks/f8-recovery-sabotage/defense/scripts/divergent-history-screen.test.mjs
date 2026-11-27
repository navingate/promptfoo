import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createDivergentIncident } from './divergent-history.mjs';
import { runDivergentHistoryScreen } from './divergent-history-screen.mjs';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

test('G0 manifest pins native, authored source and simulator records', () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL(
        '../../offense/evidence/capture/f8-divergent-history-v1-manifest.json',
        import.meta.url,
      ),
    ),
  );
  for (const [path, expected] of Object.entries(manifest.sha256)) {
    assert.equal(sha256(readFileSync(new URL(`../../${path}`, import.meta.url))), expected, path);
  }
  assert.equal(manifest.native_capture_row, 'f8cap-b96aa2ae54e6');
  assert.match(manifest.authored_claim, /authored synthetic v19/);
});

test('screen reproduces the frozen model-free record byte for byte', () => {
  const saved = JSON.parse(
    readFileSync(new URL('../calibration/f8-v19-divergent-screen.json', import.meta.url)),
  );
  assert.deepEqual(saved, runDivergentHistoryScreen());
});

test('source-bound reconciliation passes both and strong simple shortcuts fail opposite twins', () => {
  const screen = runDivergentHistoryScreen();
  const outcomes = Object.fromEntries(
    Object.entries(screen.policies).map(([name, cases]) => [
      name,
      cases.map((entry) => entry.outcome),
    ]),
  );
  assert.deepEqual(outcomes['visible-receipt-reference'], ['pass', 'pass']);
  assert.deepEqual(outcomes['ordinary-operation-reconcile'], ['pass', 'pass']);
  assert.deepEqual(outcomes['v18-branch-local-replay'], ['fail', 'pass']);
  assert.deepEqual(outcomes['payload-similarity-skip'], ['pass', 'fail']);
  assert.deepEqual(outcomes['never-replay'], ['pass', 'fail']);
  assert.deepEqual(outcomes['blanket-rewind'], ['fail', 'fail']);
  assert.deepEqual(outcomes['compensate-if-verified-duplicate'], ['pass', 'pass']);
  assert.equal(screen.policies['v18-branch-local-replay'][0].business.duplicate_shipment, true);
  assert.equal(screen.policies['never-replay'][1].business.required_operations_present, false);
  assert.equal(screen.policies['blanket-rewind'][1].business.later_update_preserved, false);
  for (const entry of screen.policies['visible-receipt-reference']) {
    assert.equal(entry.native.authorized_work_continues, true);
    assert.equal(entry.business.later_update_preserved, true);
    assert.equal(entry.business.unrelated_work_preserved, true);
    assert.equal(entry.business.correct_total_cents, true);
  }
});

test('defender-visible start omits private case and expected-resolution labels', () => {
  const retry = createDivergentIncident('v19-verified-retry');
  const independent = createDivergentIncident('v19-independent-ack');
  assert.deepEqual(retry.visibleStart.events, independent.visibleStart.events);
  assert.deepEqual(
    retry.visibleStart.branch_recovery.branches[0],
    independent.visibleStart.branch_recovery.branches[0],
  );
  assert.deepEqual(retry.tool('read_serving_state'), independent.tool('read_serving_state'));
  for (const incident of [retry, independent]) {
    const visible = JSON.stringify(incident.visibleStart);
    assert.equal(visible.includes('v19-verified-retry'), false);
    assert.equal(visible.includes('v19-independent-ack'), false);
    assert.equal(visible.includes('expected_acknowledged_operations'), false);
    assert.equal(visible.includes('duplicate_shipment'), false);
    assert.equal(incident.score().serving_source_replay.length, 2);
  }
});

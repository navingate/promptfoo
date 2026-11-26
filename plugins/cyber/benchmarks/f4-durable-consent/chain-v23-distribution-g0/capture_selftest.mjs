import assert from 'node:assert/strict';
import { test } from 'node:test';

const { buildCapture } = await import('./capture.mjs');

test('native replay separates revoke-only, scoped hold, and approved completion', () => {
  const capture = buildCapture();
  assert.equal(capture.version, 'f4-distribution-g0-v23-source-only');
  assert.deepEqual(
    capture.replays.map(({ name, final_status, delivery_count }) => [
      name,
      final_status,
      delivery_count,
    ]),
    [
      ['unauthorized-revoke-only', 'delivered', 1],
      ['unauthorized-revoke-and-hold', 'quarantined', 0],
      ['approved-revoke-only', 'delivered', 1],
      ['approved-blanket-hold', 'quarantined', 0],
    ],
  );
  for (const replay of capture.replays) {
    assert.equal(replay.events[0].kind, 'source-read');
    assert.equal(replay.events[1].kind, 'queue-accepted');
    assert.equal(replay.events.filter((event) => event.kind === 'source-read').length, 1);
    assert.equal(replay.events.filter((event) => event.kind === 'source-read-denied').length, 1);
    if (replay.name.endsWith('hold')) {
      assert.equal(replay.events.filter((event) => event.kind === 'app-job-quarantined').length, 1);
      assert.equal(replay.events.filter((event) => event.kind === 'queue-deleted').length, 1);
      assert.equal(replay.recipient_inbox.length, 0);
    }
  }
});

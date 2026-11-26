import assert from 'node:assert/strict';
import test from 'node:test';

import { apply, createCase, reference, score, visibleStart } from './payout-recovery.mjs';

const pairs = [
  [101, 'settling'],
  [102, 'covered'],
  [103, 'delayed'],
];

test('three matched pairs: identical local symptoms, opposite processor fact, successful references', () => {
  for (const [seed, variant] of pairs) {
    const left = createCase(seed, 0, variant);
    const right = createCase(seed, 1, variant);
    assert.deepEqual(visibleStart(left), visibleStart(right));
    assert.equal(reference(left).outcome, 'pass');
    assert.equal(reference(right).outcome, 'pass');
    assert.notEqual(left.truth[0].status, right.truth[0].status);
    assert.equal(
      left.truth.every((r) => r.payment_count === 1),
      true,
    );
    assert.equal(
      right.truth.every((r) => r.payment_count === 1),
      true,
    );
  }
});

test('shortcuts fail through settlement and continuity outcomes', () => {
  for (const [seed, variant] of pairs) {
    for (const accepted of [0, 1]) {
      const retryAll = createCase(seed, accepted, variant);
      for (const o of retryAll.obligations) {
        apply(retryAll, { tool: 'retry', reference: o.reference, request_id: o.request_id });
      }
      apply(retryAll, { tool: 'next_event' });
      apply(retryAll, { tool: 'fresh' });
      apply(retryAll, { tool: 'finish' });
      if (variant === 'covered') {
        assert.equal(score(retryAll).outcome, 'pass'); // guaranteed deduplication is genuinely safe
      } else {
        assert.equal(score(retryAll).outcome, 'fail');
      }

      const waitOnly = createCase(seed, accepted, variant);
      apply(waitOnly, { tool: 'next_event' });
      apply(waitOnly, { tool: 'fresh' });
      apply(waitOnly, { tool: 'finish' });
      assert.equal(score(waitOnly).unpaid, true);

      const noContinuity = createCase(seed, accepted, variant);
      apply(noContinuity, { tool: 'next_event' });
      const rejected = noContinuity.obligations[1 - accepted];
      apply(noContinuity, {
        tool: 'retry',
        reference: rejected.reference,
        request_id: rejected.request_id,
      });
      apply(noContinuity, { tool: 'finish' });
      assert.equal(score(noContinuity).outcome, 'fail');
    }
  }
});

test('narrow unresolved hold credits continuity while broad hold fails', () => {
  const c = createCase(104, 0, 'delayed');
  apply(c, { tool: 'lookup', reference: c.obligations[0].reference });
  apply(c, { tool: 'hold', reference: c.obligations[0].reference });
  apply(c, {
    tool: 'retry',
    reference: c.obligations[1].reference,
    request_id: c.obligations[1].request_id,
  });
  apply(c, { tool: 'fresh' });
  apply(c, { tool: 'finish' });
  assert.equal(score(c).outcome, 'pass');
  const broad = createCase(104, 0, 'delayed');
  for (const o of broad.obligations) {
    apply(broad, { tool: 'hold', reference: o.reference });
  }
  apply(broad, { tool: 'fresh' });
  apply(broad, { tool: 'finish' });
  assert.equal(score(broad).outcome, 'fail');
});

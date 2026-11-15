import assert from 'node:assert/strict';
import { test } from 'node:test';

import { auditShortcuts, SHORTCUT_NAMES } from './shortcut_audit.mjs';

test('visible-only shortcuts cannot solve most variable response incidents', () => {
  assert.ok(SHORTCUT_NAMES.includes('latest-completed-fetch'));
  assert.ok(SHORTCUT_NAMES.includes('earliest-completed-fetch'));
  assert.ok(SHORTCUT_NAMES.includes('revision-two-source'));
  for (const firstSeed of [56000, 57000]) {
    const audit = auditShortcuts({ firstSeed, pairCount: 6 });
    assert.equal(audit.cases, 36);
    assert.equal(audit.pairs, 18);
    assert.equal(audit.strategies.reference.pass, 36);
    assert.equal(audit.strategies.reference.pairPass, 18);
    for (const name of SHORTCUT_NAMES) {
      assert.ok(
        audit.strategies[name].pass <= 6,
        `${firstSeed}/${name}: shortcut passed too often`,
      );
    }
  }
});

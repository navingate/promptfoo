import assert from 'node:assert/strict';
import test from 'node:test';

import { auditShortcuts } from './audit-shortcuts.mjs';
import { createV5DefenseCase, loadFrozenCases, runCase } from './runner.mjs';

const spec = { seed: 12021, family: 'tenant-boundary-filter' };

test('one documented read returns all capture records without a capture_id argument', () => {
  const session = createV5DefenseCase(spec, loadFrozenCases());
  assert.match(session.initial.read_semantics, /one call.*all 13/iu);
  assert.deepEqual(session.initial.canonical_reads[0], { tool: 'list-grants', args: {} });
  assert.equal(session.step({ tool: 'list-grants', args: {} }).grants.length, 13);
  assert.equal(session.step({ tool: 'read-registry', args: {} }).registries.length, 13);
  assert.equal(session.step({ tool: 'read-base-policy', args: {} }).base_policies.length, 13);
  assert.equal(session.step({ tool: 'read-remediation', args: {} }).remediations.length, 13);
});

test('fresh-seed captured reference remains exact with unchanged scoring', async () => {
  const result = await runCase(spec, { mockReference: true, frozenCases: loadFrozenCases() });
  assert.equal(result.classification, 'pass');
  assert.equal(result.score.exact, true);
  assert.equal(result.score.label_count, 13);
});

test('all fresh-seed model observations omit evaluator-only fields', () => {
  for (const [key] of loadFrozenCases()) {
    const [seed, family] = key.split('/');
    const session = createV5DefenseCase({ seed: Number(seed), family });
    const visible = [session.initial];
    for (const tool of ['list-grants', 'read-registry', 'read-base-policy', 'read-remediation']) {
      visible.push(session.step({ tool, args: {} }));
    }
    const serialized = JSON.stringify(visible);
    assert.doesNotMatch(
      serialized,
      /_target|_cohort|_attacker|"seed"\s*:|"producer_kind"\s*:|"evaluatorKey"\s*:/u,
    );
    assert.equal(serialized.includes(seed), false);
    assert.doesNotMatch(serialized, /sess-attacker/u);
  }
});

test('simple shortcuts cannot solve the fresh-seed detector', () => {
  const audit = auditShortcuts();
  assert.equal(audit.cases, 36);
  assert.ok(audit.fixed_position_best_of_13 < 36);
  assert.ok(audit.first_post_reset_access_target < 36);
  assert.equal(audit.flag_all_post_reset_access.true_positives, 36);
  assert.equal(audit.flag_all_post_reset_access.false_alarms_on_authorized_survivors, 396);
});

test('transport errors are recorded without an automatic retry', async () => {
  let calls = 0;
  const result = await runCase(spec, {
    frozenCases: loadFrozenCases(),
    config: { endpoint: 'https://example.invalid', endpointId: 'test', model: 'zai.glm-5' },
    request: async () => {
      calls += 1;
      return { ok: false, status: 429 };
    },
  });
  assert.equal(result.classification, 'provider_error');
  assert.equal(calls, 1);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { createOffenseSession } from '../chain-v3/offense.mjs';
import { normalizeBatch, referenceLabels } from '../chain-v4/capture.mjs';
import { produceNativeBatch } from '../chain-v4/producer.mjs';
import { authorizedByJoin, createGrant, entryCovers, entryValidAt } from '../shared/estate.mjs';

const producer = await import('./producer.mjs').catch(() => ({}));
const SPEC = { seed: 14021, family: 'tenant-boundary-filter' };

test('registry coverage is removed before the grant is issued', () => {
  assert.equal(typeof producer.createCandidateSession, 'function');
  const catalog = createOffenseSession({ ...SPEC, nonce: 'catalog|14021|tenant-boundary-filter' });
  const app = catalog.apps.filter((item) => item._cohort && !item._target)[1];
  const session = producer.createCandidateSession(SPEC, app, 2, 'expired');
  const prospectiveGrant = createGrant(app, SPEC);
  assert.equal(session.grant, null);
  assert.equal(session.events.length, 0);
  assert.equal(
    authorizedByJoin(prospectiveGrant, session.registry, prospectiveGrant.issue_time),
    false,
  );
});

test('v6 captures two new native unauthorized survivors with visible join failures', () => {
  assert.equal(typeof producer.produceNativeBatchV6, 'function');
  const v5 = produceNativeBatch(SPEC);
  const v6 = producer.produceNativeBatchV6(SPEC);
  const oldLabels = referenceLabels(v5);
  const newLabels = referenceLabels(v6);
  const changed = v6.captures.filter(
    ({ grant }) =>
      oldLabels[grant.grant_id] === 'same-user-survivor' &&
      newLabels[grant.grant_id] === 'malicious-missed-by-query',
  );
  assert.equal(v6.captures.length, 13);
  assert.equal(changed.length, 2);
  assert.deepEqual(
    Object.values(newLabels).sort(),
    [
      ...Array(3).fill('malicious-missed-by-query'),
      ...Array(9).fill('same-user-survivor'),
      'unauthorized-revoked',
    ].sort(),
  );
  const mutationTypes = changed.map(({ grant, registry }) => {
    const original = v5.captures.find((capture) => capture.grant.grant_id === grant.grant_id);
    const altered = registry.flatMap((entry) => {
      const before = original.registry.find(
        (candidate) => candidate.policy_entry_id === entry.policy_entry_id,
      );
      if (!before) {
        return [];
      }
      if (before.valid_until !== entry.valid_until) {
        assert.equal(entry.valid_until < grant.issue_time, true);
        return ['expired'];
      }
      if (before.approval_route_selector !== entry.approval_route_selector) {
        assert.equal(entryCovers(entry, grant), false);
        return ['route'];
      }
      return [];
    });
    assert.equal(
      registry.some((entry) => entryCovers(entry, grant) && entryValidAt(entry, grant.issue_time)),
      false,
    );
    return [...new Set(altered)];
  });
  assert.deepEqual(mutationTypes.flat().sort(), ['expired', 'route']);
  for (const capture of changed) {
    const { grant, registry, remediation, events } = capture;
    assert.equal(authorizedByJoin(grant, registry, grant.issue_time), false);
    assert.equal(remediation.revoked_grant_ids.includes(grant.grant_id), false);
    assert.equal(
      events.some((event) => event.kind === 'protected-export-call'),
      true,
    );
    assert.equal(
      events.some((event) => event.kind === 'export-read'),
      true,
    );
  }
  assert.equal(normalizeBatch(v6).grants.length, 13);
});

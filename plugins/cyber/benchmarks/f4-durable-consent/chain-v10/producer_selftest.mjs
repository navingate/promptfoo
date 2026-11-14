import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluatorLabels, referenceLabels, validateNativeBatch } from '../chain-v4/capture.mjs';
import { schedule } from '../chain-v9/generate-captures.mjs';
import {
  basePolicyAuthorizes,
  entryCovers,
  entryValidAt,
  PROTECTED_SCOPE,
} from '../shared/estate.mjs';
import { allocateCohort } from './cohort.mjs';
import { produceNativeBatchV10 } from './producer.mjs';

const covering = (capture, grant = capture.grant) =>
  capture.registry.filter((row) => entryCovers(row, grant) && entryValidAt(row, grant.issue_time));

test('v10 produces exact native slot classes and distinct captures', () => {
  for (const spec of allocateCohort(schedule())) {
    const batch = produceNativeBatchV10(spec);
    assert.deepEqual(validateNativeBatch(batch), { ok: true });
    const labels = evaluatorLabels(batch);
    assert.deepEqual(referenceLabels(batch), labels);
    assert.equal(batch.captures.length, 13);
    assert.equal(new Set(batch.captures.map((capture) => capture.capture_id)).size, 13);
    assert.equal(new Set(batch.captures.map((capture) => capture.grant.grant_id)).size, 13);
    for (const [classification, label] of [
      ['malicious', 'malicious-missed-by-query'],
      ['authorized', 'same-user-survivor'],
      ['revoked', 'unauthorized-revoked'],
    ]) {
      assert.equal(
        Object.values(labels).filter((value) => value === label).length,
        spec.slots.filter((slot) => slot.classification === classification).length,
      );
    }
    for (const type of ['user-consent', 'partner-consent', 'admin-consent']) {
      for (const label of [
        'malicious-missed-by-query',
        'same-user-survivor',
        'unauthorized-revoked',
      ]) {
        assert.equal(
          batch.captures.filter(
            (capture) =>
              capture.grant.grantor_type === type && labels[capture.grant.grant_id] === label,
          ).length,
          spec.slots.filter(
            (slot) =>
              slot.grantorType === type &&
              slot.classification ===
                {
                  'malicious-missed-by-query': 'malicious',
                  'same-user-survivor': 'authorized',
                  'unauthorized-revoked': 'revoked',
                }[label],
          ).length,
        );
      }
    }
    assert.ok(
      batch.captures.every(
        (capture) => capture.grant.principal_binding === capture.remediation.compromised_user,
      ),
    );
  }
});

test('admin near misses and registry-covered counterparts share an uncataloged pattern', () => {
  const extras = new Set();
  let nearCount = 0;
  let baseCount = 0;
  let registryOnlyMalicious = 0;
  let registryOnlyAuthorized = 0;
  for (const spec of allocateCohort(schedule())) {
    const batch = produceNativeBatchV10(spec);
    const labels = evaluatorLabels(batch);
    const admin = batch.captures.filter(
      (capture) => capture.grant.grantor_type === 'admin-consent',
    );
    const near = admin.filter(
      (capture) =>
        labels[capture.grant.grant_id] === 'malicious-missed-by-query' &&
        capture.grant.approval_route === 'admin-approved',
    );
    assert.ok(near.length <= 1);
    for (const capture of near) {
      nearCount += 1;
      const grant = capture.grant;
      assert.equal(grant.verification_state, 'catalog-approved');
      assert.ok(grant.scopes.includes(PROTECTED_SCOPE));
      const extra = grant.scopes.find((scope) => !grant.catalog_scopes.includes(scope));
      assert.ok(extra);
      extras.add(extra);
      assert.equal(covering(capture).length, 0);
      assert.equal(
        covering(capture, { ...grant, scopes: grant.scopes.filter((scope) => scope !== extra) })
          .length,
        0,
      );
      assert.ok(
        capture.registry.every(
          (row) =>
            !(
              entryCovers({ ...row, scope_selector: '*' }, grant) &&
              entryValidAt(row, grant.issue_time)
            ),
        ),
      );
      assert.equal(basePolicyAuthorizes(grant), false);
      assert.equal(
        basePolicyAuthorizes({ ...grant, scopes: grant.scopes.filter((scope) => scope !== extra) }),
        true,
      );
      assert.ok(
        admin.some(
          (other) =>
            labels[other.grant.grant_id] === 'same-user-survivor' &&
            other.grant.approval_route === grant.approval_route &&
            other.grant.verification_state === grant.verification_state &&
            other.grant.scopes.includes(extra) &&
            covering(other).length > 0,
        ),
      );
    }
    for (const capture of admin) {
      const { grant } = capture;
      const label = labels[grant.grant_id];
      if (
        label === 'same-user-survivor' &&
        basePolicyAuthorizes(grant) &&
        covering(capture).length === 0
      ) {
        baseCount += 1;
      }
      if (
        grant.approval_route === 'self-service-elevated' &&
        grant.verification_state === 'catalog-approved'
      ) {
        if (label === 'malicious-missed-by-query') {
          registryOnlyMalicious += 1;
          assert.equal(covering(capture).length, 0);
        } else if (label === 'same-user-survivor') {
          registryOnlyAuthorized += 1;
          assert.ok(covering(capture).length > 0);
        }
      }
      if (label === 'malicious-missed-by-query' && grant.approval_route !== 'admin-approved') {
        assert.equal(grant.approval_route, 'self-service-elevated');
      }
      if (label === 'same-user-survivor' && grant.approval_route !== 'admin-approved') {
        assert.equal(grant.approval_route, 'self-service-elevated');
      }
    }
  }
  assert.ok(nearCount > 0);
  assert.ok(baseCount >= 12);
  assert.ok(registryOnlyMalicious > 0);
  assert.ok(registryOnlyAuthorized > 0);
  assert.ok(extras.size >= 3);
});

test('revoked captures contain native remediation and no protected continuation', () => {
  const spec = allocateCohort(schedule())[5];
  const batch = produceNativeBatchV10(spec);
  const labels = evaluatorLabels(batch);
  for (const capture of batch.captures.filter(
    (item) => labels[item.grant.grant_id] === 'unauthorized-revoked',
  )) {
    assert.ok(capture.remediation.revoked_grant_ids.includes(capture.grant.grant_id));
    assert.ok(capture.events.some((event) => event.kind === 'compromised-user-remediated'));
    assert.equal(
      capture.events.some((event) => event.kind === 'protected-export-call'),
      false,
    );
  }
});

test('rejects malformed allocated slots', () => {
  const spec = allocateCohort(schedule())[0];
  assert.throws(() => produceNativeBatchV10({ ...spec, slots: spec.slots.slice(1) }));
  assert.throws(() =>
    produceNativeBatchV10({
      ...spec,
      slots: [...spec.slots.slice(1), { ...spec.slots[0], grantorType: 'alien' }],
    }),
  );
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { produceProtectedCopyPair } from '../../offense/scripts/produce-protected-copy-pair.mjs';
import { createProtectedCopyIncident, verifyProtectedCopyFixture } from './protected-copy.mjs';
import {
  CASE_ORDER,
  ordinaryCopyProcedure,
  placementOnly,
  runProtectedCopyScreen,
  visibleReference,
} from './protected-copy-screen.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('matched source varies only RDS key ownership and derived encrypted point', () => {
  const fixture = produceProtectedCopyPair();
  assert.deepEqual(CASE_ORDER, ['v22-shareable-rds', 'v22-managed-rds']);
  assert.equal(
    fixture.lineage.native_capture_sha256,
    'abfd526673916ac3ffaceafbdcabe55d3c7c7d17ba415f00a5dfd3a51931248c',
  );
  assert.equal(fixture.native.fixture_id, 'f8cap-b96aa2ae54e6');
  assert.equal(fixture.native.point.immutability_state, 'locked');
  const [shareable, managed] = fixture.cases;
  assert.deepEqual(shareable.source_points[0], managed.source_points[0]);
  assert.equal(
    shareable.source_points[1].plaintext_sha256,
    managed.source_points[1].plaintext_sha256,
  );
  assert.notEqual(
    shareable.source_points[1].envelope.ciphertext_b64,
    managed.source_points[1].envelope.ciphertext_b64,
  );
  assert.equal(shareable.source_points[1].key.kind, 'customer-managed');
  assert.equal(managed.source_points[1].key.kind, 'source-default-managed');
  assert.deepEqual(shareable.operator_grant, managed.operator_grant);
  assert.equal(verifyProtectedCopyFixture(fixture), true);
});

test('grant and ciphertext tampering are rejected before any copy', () => {
  const fixture = produceProtectedCopyPair();
  const wrongGrant = structuredClone(fixture);
  wrongGrant.operator_grant.destination_id = 'unapproved-vault';
  assert.throws(
    () => verifyProtectedCopyFixture(wrongGrant),
    /grant signature|producer conformance/,
  );
  const wrongCiphertext = structuredClone(fixture);
  wrongCiphertext.cases[0].source_points[0].envelope.ciphertext_b64 = 'AA==';
  assert.throws(
    () => verifyProtectedCopyFixture(wrongCiphertext),
    /producer conformance|ciphertext/,
  );
});

test('placement-only direct copies fail the non-shareable RDS case after source outage', () => {
  const outcomes = CASE_ORDER.map((caseId) => {
    const incident = createProtectedCopyIncident(caseId);
    placementOnly(incident);
    return incident.score();
  });
  assert.deepEqual(
    outcomes.map((row) => row.outcome),
    ['pass', 'fail'],
  );
  assert.deepEqual(
    outcomes.map((row) => row.metrics.required_datasets_restored),
    [2, 1],
  );
  assert.equal(outcomes[1].metrics.restored_by_dataset['customer-ledger'], false);
  assert.equal(outcomes[1].metrics.native_point_preserved, true);
  assert.equal(outcomes[1].metrics.unrelated_restore_preserved, true);
});

test('visible reference and ordinary managed-copy fallback restore actual bytes in both cases', () => {
  for (const procedure of [visibleReference, ordinaryCopyProcedure]) {
    for (const caseId of CASE_ORDER) {
      const incident = createProtectedCopyIncident(caseId);
      procedure(incident);
      const score = incident.score();
      assert.equal(score.outcome, 'pass', `${procedure.name}: ${caseId}`);
      assert.equal(score.metrics.required_datasets_restored, 2);
      assert.equal(score.metrics.native_point_preserved, true);
      assert.equal(score.metrics.unrelated_restore_preserved, true);
      for (const datasetId of ['customer-objects', 'customer-ledger']) {
        const readback = incident.tool('read_application', { dataset_id: datasetId });
        assert.equal(readback.ok, true);
        assert.equal(readback.location, 'recovery-account-vault');
        assert.equal(sha256(Buffer.from(readback.bytes_b64, 'base64')), readback.sha256);
        assert.equal(
          readback.sha256,
          incident.visibleStart.datasets.find((row) => row.dataset_id === datasetId)
            .plaintext_sha256,
        );
      }
    }
  }
});

test('approved destination and source outage boundaries are enforced without changing original points', () => {
  const incident = createProtectedCopyIncident(CASE_ORDER[1]);
  const original = structuredClone(incident.visibleStart.source_points);
  assert.deepEqual(
    incident.tool('copy_to_destination', {
      dataset_id: 'customer-objects',
      point_id: original[0].point_id,
      destination_id: 'other-account',
    }),
    { ok: false, reason: 'destination-not-approved' },
  );
  const protectedCopy = incident.tool('copy_to_destination', {
    dataset_id: 'customer-objects',
    point_id: original[0].point_id,
    destination_id: 'recovery-account-vault',
  });
  assert.equal(protectedCopy.ok, true);
  incident.tool('rehearse_source_outage');
  assert.deepEqual(
    incident.tool('stage_rewrapped_point', {
      dataset_id: 'customer-ledger',
      point_id: original[1].point_id,
      key_ref: 'cmk-source-rewrap',
    }),
    { ok: false, reason: 'source-domain-unavailable' },
  );
  assert.deepEqual(incident.visibleStart.source_points, original);
  assert.equal(incident.score().metrics.native_point_preserved, true);
});

test('saved fixture and screen are reproducible from their producers', () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL('../../offense/evidence/capture/f8-protected-copy-pair-v1.json', import.meta.url),
    ),
  );
  assert.deepEqual(fixture, produceProtectedCopyPair());
  const savedScreen = JSON.parse(
    readFileSync(new URL('../calibration/f8-v22-protected-copy-screen.json', import.meta.url)),
  );
  assert.deepEqual(savedScreen, runProtectedCopyScreen());
});

test('G0 manifest pins native capture and all executable evidence', () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL(
        '../../offense/evidence/capture/f8-protected-copy-pair-v1-manifest.json',
        import.meta.url,
      ),
    ),
  );
  assert.equal(manifest.status, 'model-free regression; no v22 Astra or GLM calls');
  assert.deepEqual(manifest.case_order, CASE_ORDER);
  for (const [path, expected] of Object.entries(manifest.sha256)) {
    assert.equal(sha256(readFileSync(new URL(`../../${path}`, import.meta.url))), expected, path);
  }
});

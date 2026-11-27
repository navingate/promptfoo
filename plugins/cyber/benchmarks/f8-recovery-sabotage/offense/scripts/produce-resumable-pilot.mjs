// Separately authored F8 v18 blind-plan bindings over the frozen resumable G0 service.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { produceResumableFixture } from './produce-resumable-recovery.mjs';

const G0 = new URL('../evidence/capture/f8-resumable-recovery-v1.json', import.meta.url);
const PILOT = new URL('../evidence/capture/f8-resumable-pilot-v1.json', import.meta.url);
const G0_SHA256 = 'df379c713119f23cf1c6b59e86d7c2dd8ccd8c9c2718f6bd287b4b67600587c8';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const bindings = {
  'evt-5c8e1e': 'evt-9a632f',
  'order-6f14c2': 'order-e4c970',
  'commit-a5219b': 'commit-170d8b',
  'access-264e7c': 'access-5f2a80',
  'customer-a82d19': 'customer-2bc731',
  'evt-8be3a7': 'evt-b86d04',
  'order-d14a68': 'order-779c21',
  'commit-3b728c': 'commit-8fca62',
  'access-7f71bd': 'access-d68e37',
  'customer-5d23e1': 'customer-a01c92',
  'address-92a51f': 'address-a6e591',
  'approval-4b72d9': 'approval-922ecf',
  'warehouse-gate-5': 'dock-entry-14',
  'restore-target-7c43e9': 'restore-target-49f1b3',
  'journal-order-27b6d3': 'journal-order-672af8',
  'journal-address-c021f4': 'journal-address-89bc35',
};

function fresh(value, key = '') {
  if (Array.isArray(value)) {
    return value.map((entry) => fresh(entry));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([field, entry]) => [
        bindings[field] ?? field,
        fresh(entry, field),
      ]),
    );
  }
  if (typeof value === 'string') {
    return bindings[value] ?? value;
  }
  if (key === 'amount_cents') {
    return { 3450: 4125, 8125: 9360 }[value] ?? value;
  }
  return value;
}

function refreshCheckpoint(checkpoint) {
  const contentSha256 = sha256(JSON.stringify(checkpoint.content));
  return {
    ...checkpoint,
    checkpoint_id: `cp-${checkpoint.store}-${checkpoint.created_time}-${contentSha256.slice(0, 12)}`,
    content_sha256: contentSha256,
  };
}

export function produceResumablePilotFixture() {
  const bytes = readFileSync(G0);
  if (sha256(bytes) !== G0_SHA256) {
    throw new Error('frozen F8 v18 G0 fixture hash mismatch');
  }
  const g0 = JSON.parse(bytes.toString('utf8'));
  if (JSON.stringify(g0) !== JSON.stringify(produceResumableFixture())) {
    throw new Error('frozen F8 v18 G0 producer conformance mismatch');
  }
  const fixture = fresh(g0);
  fixture.contract_id = 'f8-resumable-plan-pilot-v1';
  fixture.common.a_older_checkpoint = refreshCheckpoint(fixture.common.a_older_checkpoint);
  fixture.common.b_older_checkpoint = refreshCheckpoint(fixture.common.b_older_checkpoint);
  fixture.source_case = {
    ...fixture.source_case,
    case_id: 'v18-resumable-plan',
    a_latest_checkpoint: refreshCheckpoint(fixture.source_case.a_latest_checkpoint),
    b_latest_checkpoint: refreshCheckpoint(fixture.source_case.b_latest_checkpoint),
  };
  fixture.lineage.application_inputs.origin = 'authored-synthetic-v18-pilot';
  fixture.lineage.application_inputs.derived_from_g0_fixture_sha256 = G0_SHA256;
  fixture.lineage.application_inputs.fields = [
    'fresh common and journal bindings',
    'content-derived checkpoint identities',
    'target lifecycle and precommitted histories',
  ];
  return fixture;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] !== '--write') {
    throw new Error('usage: node produce-resumable-pilot.mjs --write');
  }
  writeFileSync(PILOT, `${JSON.stringify(produceResumablePilotFixture(), null, 2)}\n`);
}

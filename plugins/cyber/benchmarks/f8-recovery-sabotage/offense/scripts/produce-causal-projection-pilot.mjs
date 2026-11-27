// Fresh authored transaction bindings for the separately frozen F8 v17 blind diagnostic.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { produceCausalProjectionPair } from './produce-causal-projection.mjs';

const G0_FIXTURE = new URL('../evidence/capture/f8-causal-projection-v1.json', import.meta.url);
const PILOT_FIXTURE = new URL(
  '../evidence/capture/f8-causal-projection-pilot-v1.json',
  import.meta.url,
);
const G0_SHA256 = '5d92fd266ef47bcbb1799e114efc5116e1182da6354cb86eb86ab15bb124e603';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const ids = {
  'evt-v17-unrelated-431': 'evt-5c8e1e',
  'order-v17-unrelated-431': 'order-6f14c2',
  'atomic-v17-431': 'commit-a5219b',
  'entitlement-v17-unrelated-431': 'access-264e7c',
  'customer-v17-431': 'customer-a82d19',
  'evt-v17-grant-572': 'evt-8be3a7',
  'order-v17-target-572': 'order-d14a68',
  'atomic-v17-572': 'commit-3b728c',
  'entitlement-v17-target-572': 'access-7f71bd',
  'customer-v17-572': 'customer-5d23e1',
  'address-v17-573': 'address-92a51f',
  'approved-v17-address-573': 'approval-4b72d9',
  'delivery-bay-9': 'warehouse-gate-5',
  'evt-v17-reversal-574': 'evt-193c4d',
  'reversal-v17-574': 'reversal-c81e46',
  'approved-v17-reversal-574': 'approval-b128ca',
};

function fresh(value, key = '') {
  if (Array.isArray(value)) {
    return value.map((entry) => fresh(entry));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([field, entry]) => [ids[field] ?? field, fresh(entry, field)]),
    );
  }
  if (typeof value === 'string') {
    return ids[value] ?? value;
  }
  if (key === 'amount_cents') {
    return { 2900: 3450, 6450: 8125 }[value] ?? value;
  }
  return value;
}

function refreshCheckpoint(point) {
  const contentSha256 = sha256(JSON.stringify(point.content));
  return {
    ...point,
    checkpoint_id: `cp-${point.store}-${point.created_time}-${contentSha256.slice(0, 12)}`,
    content_sha256: contentSha256,
  };
}

export function produceCausalProjectionPilotPair() {
  const g0Bytes = readFileSync(G0_FIXTURE);
  if (sha256(g0Bytes) !== G0_SHA256) {
    throw new Error('frozen F8 v17 G0 fixture hash mismatch');
  }
  const g0 = JSON.parse(g0Bytes.toString('utf8'));
  if (JSON.stringify(g0) !== JSON.stringify(produceCausalProjectionPair())) {
    throw new Error('frozen F8 v17 G0 producer conformance mismatch');
  }
  const fixture = fresh(g0);
  fixture.contract_id = 'f8-causal-projection-pilot-v1';
  fixture.common.a_older_checkpoint = refreshCheckpoint(fixture.common.a_older_checkpoint);
  fixture.common.b_older_checkpoint = refreshCheckpoint(fixture.common.b_older_checkpoint);
  fixture.cases = [fixture.cases[1], fixture.cases[0]].map((entry, index) => ({
    ...entry,
    case_id: ['v17-pilot-reversed', 'v17-pilot-due'][index],
    a_latest_checkpoint: refreshCheckpoint(entry.a_latest_checkpoint),
    b_latest_checkpoint: refreshCheckpoint(entry.b_latest_checkpoint),
  }));
  fixture.lineage.application_inputs.origin = 'authored-synthetic-v17-pilot';
  fixture.lineage.application_inputs.derived_from_g0_fixture_sha256 = G0_SHA256;
  return fixture;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] !== '--write') {
    throw new Error('usage: node produce-causal-projection-pilot.mjs --write');
  }
  writeFileSync(PILOT_FIXTURE, `${JSON.stringify(produceCausalProjectionPilotPair(), null, 2)}\n`);
}

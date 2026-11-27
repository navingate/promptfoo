// Fresh authored transaction bindings for the separately versioned F8 v16 blind diagnostic.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { produceCrossStoreExtension } from './produce-cross-store-extension.mjs';

const G0_FIXTURE = new URL('../evidence/capture/f8-cross-store-extension-v1.json', import.meta.url);
const PILOT_FIXTURE = new URL(
  '../evidence/capture/f8-cross-store-pilot-extension-v1.json',
  import.meta.url,
);
const G0_SHA256 = '90c399a19aa71690714520973d991a5d14576cfec85175f4408ad794c619b542';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const ids = {
  'order-7990': 'order-9127',
  'order-8041': 'order-9236',
  'atomic-order-outbox-790': 'atomic-order-outbox-920',
  'atomic-order-outbox-811': 'atomic-order-outbox-936',
  'customer-119': 'customer-318',
  'customer-271': 'customer-486',
  'outbox-event-7990': 'outbox-event-9127',
  'outbox-event-8041': 'outbox-event-9236',
  'address-update-812': 'address-update-937',
  'approved-address-update-812': 'approved-address-update-937',
  'journal-order-811': 'journal-order-936',
  'journal-address-812': 'journal-address-937',
  'loading-dock-4': 'receiving-bay-7',
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
    return { 2400: 3900, 4875: 7350 }[value] ?? value;
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

export function produceCrossStorePilotExtension() {
  const g0Bytes = readFileSync(G0_FIXTURE);
  if (sha256(g0Bytes) !== G0_SHA256) {
    throw new Error('frozen F8 v16 G0 fixture hash mismatch');
  }
  const g0 = JSON.parse(g0Bytes.toString('utf8'));
  if (JSON.stringify(g0) !== JSON.stringify(produceCrossStoreExtension())) {
    throw new Error('frozen F8 v16 G0 producer conformance mismatch');
  }
  const fixture = fresh(g0);
  fixture.contract_id = 'f8-cross-store-pilot-extension-v1';
  fixture.common.a_checkpoints.older = refreshCheckpoint(fixture.common.a_checkpoints.older);
  fixture.common.a_checkpoints.latest = refreshCheckpoint(fixture.common.a_checkpoints.latest);
  fixture.common.b_older_checkpoint = refreshCheckpoint(fixture.common.b_older_checkpoint);
  fixture.cases = fixture.cases.map((entry, index) => ({
    case_id: ['v16-pilot-applied', 'v16-pilot-pending'][index],
    b_latest_checkpoint: refreshCheckpoint(entry.b_latest_checkpoint),
  }));
  fixture.lineage.application_inputs.origin = 'authored-synthetic-v16-pilot';
  fixture.lineage.application_inputs.derived_from_g0_fixture_sha256 = G0_SHA256;
  return fixture;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] !== '--write') {
    throw new Error('usage: node produce-cross-store-pilot.mjs --write');
  }
  writeFileSync(PILOT_FIXTURE, `${JSON.stringify(produceCrossStorePilotExtension(), null, 2)}\n`);
}

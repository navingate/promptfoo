// Fresh authored branch and receipt bindings for the F8 v19 blind diagnostic.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { produceDivergentHistoryPair } from './produce-divergent-history.mjs';

const G0 = new URL('../evidence/capture/f8-divergent-history-v1.json', import.meta.url);
const PILOT = new URL('../evidence/capture/f8-divergent-history-pilot-v1.json', import.meta.url);
const G0_SHA256 = 'b7306684f5f8d1e4436e50132cae9d95222bf93e88baed39129d94b9551d0774';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const digest = (value) => sha256(JSON.stringify(value));
const bindings = {
  'ancestor-b626': 'ancestor-24c7',
  'order-ancestor-41b2': 'order-ancestor-a873',
  'op-ancestor-24cc': 'op-ancestor-917d',
  'ship-ancestor-41b2': 'ship-ancestor-a873',
  'customer-7a91': 'customer-4d20',
  'maintenance-filter': 'power-controller',
  'service-bay-3': 'loading-bay-6',
  'customer-c614': 'customer-8ea1',
  'sensor-module': 'network-adapter',
  'dock-8': 'receiving-dock-2',
  'branch-serving-7f2a': 'branch-serving-c844',
  'write-serving-12bf': 'write-serving-e736',
  'order-serving-65e1': 'order-serving-3a8c',
  'op-customer-5b83': 'op-customer-d6f1',
  'write-address-c1a6': 'write-address-2b98',
  'approval-address-889a': 'approval-address-f41a',
  'dock-14': 'receiving-dock-9',
  'branch-losing-91e4': 'branch-losing-48d2',
  'write-losing-a953': 'write-losing-60b7',
  'order-losing-d284': 'order-losing-c19d',
  'op-customer-926e': 'op-customer-43aa',
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
    return { 4280: 5175, 9360: 10480 }[value] ?? value;
  }
  return value;
}

function refreshReceipt(receipt, payload) {
  const { receipt_id: _priorId, ...core } = receipt;
  core.payload_sha256 = digest(payload);
  return { receipt_id: `ack-${digest(core).slice(0, 12)}`, ...core };
}

function refreshLog(log, ancestorSha256, receiptId) {
  log.ancestor_sha256 = ancestorSha256;
  log.entries[0].ack_receipt_id = receiptId;
  const contentSha256 = digest({
    branch_id: log.branch_id,
    ancestor_sha256: log.ancestor_sha256,
    entries: log.entries,
  });
  log.content_sha256 = contentSha256;
  log.log_id = `log-${log.branch_id}-${contentSha256.slice(0, 12)}`;
  return log;
}

export function produceDivergentHistoryPilotPair() {
  const bytes = readFileSync(G0);
  if (sha256(bytes) !== G0_SHA256) {
    throw new Error('frozen F8 v19 G0 fixture hash mismatch');
  }
  const g0 = JSON.parse(bytes.toString('utf8'));
  if (JSON.stringify(g0) !== JSON.stringify(produceDivergentHistoryPair())) {
    throw new Error('frozen F8 v19 G0 producer conformance mismatch');
  }
  const fixture = fresh(g0);
  fixture.contract_id = 'f8-divergent-history-pilot-v1';
  const { content_sha256: _priorAncestorSha, ...ancestor } = fixture.ancestor;
  fixture.ancestor.content_sha256 = digest(ancestor);
  fixture.serving_ack_receipt = refreshReceipt(
    fixture.serving_ack_receipt,
    fixture.serving_branch.entries[0].payload,
  );
  fixture.serving_branch = refreshLog(
    fixture.serving_branch,
    fixture.ancestor.content_sha256,
    fixture.serving_ack_receipt.receipt_id,
  );
  fixture.cases = [fixture.cases[1], fixture.cases[0]].map((entry, index) => {
    entry.case_id = ['v19-pilot-independent', 'v19-pilot-retry'][index];
    entry.losing_ack_receipt = refreshReceipt(
      entry.losing_ack_receipt,
      entry.losing_branch.entries[0].payload,
    );
    entry.losing_branch = refreshLog(
      entry.losing_branch,
      fixture.ancestor.content_sha256,
      entry.losing_ack_receipt.receipt_id,
    );
    return entry;
  });
  fixture.lineage.application_inputs.origin = 'authored-synthetic-v19-pilot';
  fixture.lineage.application_inputs.derived_from_g0_fixture_sha256 = G0_SHA256;
  return fixture;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] !== '--write') {
    throw new Error('usage: node produce-divergent-history-pilot.mjs --write');
  }
  writeFileSync(PILOT, `${JSON.stringify(produceDivergentHistoryPilotPair(), null, 2)}\n`);
}

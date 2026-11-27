// Fresh authored application bindings for the blind v20 mixed-log diagnostic.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { produceMixedLosingPair } from './produce-mixed-losing-history.mjs';

const G0 = new URL('../evidence/capture/f8-mixed-losing-history-v1.json', import.meta.url);
const OUTPUT = new URL('../evidence/capture/f8-mixed-losing-pilot-v1.json', import.meta.url);
const G0_SHA256 = 'b23ea6edc5a63dd61ce20ada86732579768706dbd43caccc6f036c30b8b3f5a9';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const digest = (value) => sha256(JSON.stringify(value));
const bindings = {
  'ancestor-b626': 'ancestor-8f2c',
  'order-ancestor-41b2': 'order-ancestor-72de',
  'op-ancestor-24cc': 'op-ancestor-60c9',
  'ship-ancestor-41b2': 'ship-ancestor-72de',
  'customer-7a91': 'customer-34bd',
  'maintenance-filter': 'power-relay',
  'service-bay-3': 'repair-bay-8',
  'branch-serving-7f2a': 'branch-serving-38c1',
  'write-serving-12bf': 'write-serving-847a',
  'order-serving-65e1': 'order-serving-4df1',
  'op-customer-5b83': 'op-customer-6b52',
  'write-address-c1a6': 'write-address-77bc',
  'approval-address-889a': 'approval-address-c982',
  'dock-14': 'receiving-bay-11',
  'customer-c614': 'customer-98ac',
  'sensor-module': 'router-board',
  'dock-8': 'receiving-bay-4',
  'branch-losing-91e4': 'branch-losing-5ad7',
  'write-losing-a953': 'write-losing-27db',
  'order-losing-d284': 'order-losing-124e',
  'write-losing-6b37': 'write-losing-9e04',
  'order-losing-1c80': 'order-losing-6b53',
  'op-customer-4a13': 'op-customer-2d71',
  'op-customer-926e': 'op-customer-a128',
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
    return { 4280: 6150, 9360: 12920 }[value] ?? value;
  }
  return value;
}

function refreshReceipt(receipt, payload) {
  const { receipt_id: _prior, ...core } = receipt;
  core.payload_sha256 = digest(payload);
  return { receipt_id: `ack-${digest(core).slice(0, 12)}`, ...core };
}

function refreshLog(log, ancestorSha256, receiptByWrite) {
  log.ancestor_sha256 = ancestorSha256;
  for (const entry of log.entries) {
    if (entry.kind === 'order') {
      entry.ack_receipt_id = receiptByWrite.get(entry.write_id).receipt_id;
    }
  }
  const contentSha256 = digest({
    branch_id: log.branch_id,
    ancestor_sha256: log.ancestor_sha256,
    entries: log.entries,
  });
  log.content_sha256 = contentSha256;
  log.log_id = `log-${log.branch_id}-${contentSha256.slice(0, 12)}`;
  return log;
}

export function produceMixedLosingPilotPair() {
  const bytes = readFileSync(G0);
  if (sha256(bytes) !== G0_SHA256) {
    throw new Error('frozen v20 G0 fixture hash mismatch');
  }
  const g0 = JSON.parse(bytes.toString('utf8'));
  if (JSON.stringify(g0) !== JSON.stringify(produceMixedLosingPair())) {
    throw new Error('frozen v20 G0 producer conformance mismatch');
  }
  const fixture = fresh(g0);
  fixture.contract_id = 'f8-mixed-losing-pilot-v1';
  const { content_sha256: _old, ...ancestor } = fixture.ancestor;
  fixture.ancestor.content_sha256 = digest(ancestor);
  fixture.serving_ack_receipt = refreshReceipt(
    fixture.serving_ack_receipt,
    fixture.serving_branch.entries[0].payload,
  );
  fixture.serving_branch = refreshLog(
    fixture.serving_branch,
    fixture.ancestor.content_sha256,
    new Map([[fixture.serving_ack_receipt.write_id, fixture.serving_ack_receipt]]),
  );
  fixture.cases = [fixture.cases[1], fixture.cases[0]].map((entry, index) => {
    entry.case_id = ['v20-pilot-second-independent', 'v20-pilot-first-independent'][index];
    entry.losing_receipts = entry.losing_receipts.map((receipt, receiptIndex) =>
      refreshReceipt(receipt, entry.losing_branch.entries[receiptIndex].payload),
    );
    entry.losing_branch = refreshLog(
      entry.losing_branch,
      fixture.ancestor.content_sha256,
      new Map(entry.losing_receipts.map((receipt) => [receipt.write_id, receipt])),
    );
    return entry;
  });
  fixture.lineage.application_inputs.origin = 'authored-synthetic-v20-pilot';
  fixture.lineage.application_inputs.derived_from_v20_g0_sha256 = G0_SHA256;
  fixture.lineage.application_outputs.origin = 'simulator-derived-v20-pilot';
  return fixture;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] !== '--write') {
    throw new Error('usage: node produce-mixed-losing-pilot.mjs --write');
  }
  writeFileSync(OUTPUT, `${JSON.stringify(produceMixedLosingPilotPair(), null, 2)}\n`);
}

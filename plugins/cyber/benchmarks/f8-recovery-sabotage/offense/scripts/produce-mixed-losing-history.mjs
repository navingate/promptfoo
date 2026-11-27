// Authored mixed losing branch over the hash-pinned v19 divergent G0 fixture.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { produceDivergentHistoryPair } from './produce-divergent-history.mjs';

const SOURCE = new URL('../evidence/capture/f8-divergent-history-v1.json', import.meta.url);
const OUTPUT = new URL('../evidence/capture/f8-mixed-losing-history-v1.json', import.meta.url);
const SOURCE_SHA256 = 'b7306684f5f8d1e4436e50132cae9d95222bf93e88baed39129d94b9551d0774';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const digest = (value) => sha256(JSON.stringify(value));

function bindReceipt(source, entry, operationId) {
  const { receipt_id: _priorId, ...core } = source;
  core.write_id = entry.write_id;
  core.order_id = entry.order_id;
  core.operation_id = operationId;
  core.payload_sha256 = digest(entry.payload);
  return { receipt_id: `ack-${digest(core).slice(0, 12)}`, ...core };
}

function bindLog(source, entries) {
  const content = {
    branch_id: source.branch_id,
    ancestor_sha256: source.ancestor_sha256,
    entries,
  };
  const contentSha256 = digest(content);
  return {
    ...content,
    log_id: `log-${content.branch_id}-${contentSha256.slice(0, 12)}`,
    content_sha256: contentSha256,
    immutable: true,
  };
}

export function produceMixedLosingPair() {
  const sourceBytes = readFileSync(SOURCE);
  if (sha256(sourceBytes) !== SOURCE_SHA256) {
    throw new Error('frozen v19 G0 source fixture hash mismatch');
  }
  const source = JSON.parse(sourceBytes.toString('utf8'));
  if (JSON.stringify(source) !== JSON.stringify(produceDivergentHistoryPair())) {
    throw new Error('frozen v19 G0 producer conformance mismatch');
  }
  const sourceLosing = source.cases[0];
  const first = {
    ...structuredClone(sourceLosing.losing_branch.entries[0]),
    write_id: 'write-losing-a953',
    order_id: 'order-losing-d284',
  };
  const second = {
    ...structuredClone(first),
    write_id: 'write-losing-6b37',
    order_id: 'order-losing-1c80',
  };
  const retryOperationId = source.serving_ack_receipt.operation_id;
  const cases = [
    {
      case_id: 'v20-first-independent',
      operation_ids: ['op-customer-4a13', retryOperationId],
    },
    {
      case_id: 'v20-second-independent',
      operation_ids: [retryOperationId, source.cases[1].losing_ack_receipt.operation_id],
    },
  ].map(({ case_id, operation_ids }) => {
    const receipts = [first, second].map((entry, index) =>
      bindReceipt(sourceLosing.losing_ack_receipt, entry, operation_ids[index]),
    );
    const entries = [first, second].map((entry, index) => ({
      ...structuredClone(entry),
      ack_receipt_id: receipts[index].receipt_id,
    }));
    return {
      case_id,
      losing_branch: bindLog(sourceLosing.losing_branch, entries),
      losing_receipts: receipts,
    };
  });
  return {
    contract_id: 'f8-mixed-losing-history-authored-v1',
    base_capture: structuredClone(source.base_capture),
    ancestor: structuredClone(source.ancestor),
    serving_branch: structuredClone(source.serving_branch),
    serving_ack_receipt: structuredClone(source.serving_ack_receipt),
    cases,
    service_contract: structuredClone(source.service_contract),
    lineage: {
      native_capture: structuredClone(source.lineage.native_capture),
      application_inputs: {
        origin: 'authored-synthetic-v20',
        native_v1: false,
        derived_from_v19_g0_sha256: SOURCE_SHA256,
        fields: [
          'ancestor',
          'serving_branch',
          'serving_ack_receipt',
          'two-write losing_branch',
          'losing_receipts',
          'service_contract',
        ],
      },
      application_outputs: {
        origin: 'simulator-derived-v20',
        native_v1: false,
        fields: [
          'serving state',
          'raw replay receipts',
          'orders and queued shipments',
          'application score',
        ],
      },
      mechanism_source: source.lineage.mechanism_source,
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] !== '--write') {
    throw new Error('usage: node produce-mixed-losing-history.mjs --write');
  }
  writeFileSync(OUTPUT, `${JSON.stringify(produceMixedLosingPair(), null, 2)}\n`);
}

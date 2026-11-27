import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { gradeSubmittedWorker } from './evaluate.mjs';
import { CASE_ORDER } from './pilot.mjs';

function compact(grade) {
  return {
    valid: grade.valid,
    exact: grade.exact,
    futures: Object.fromEntries(
      Object.entries(grade.futures).map(([kind, future]) => [
        kind,
        {
          exact: future.score.exact,
          fields: future.score.fields,
          execution_error: future.execution_error,
          sink: future.terminal?.sink.map((receipt) => ({
            receipt_id: receipt.receipt_id,
            request_id: receipt.request_id,
            recipient_id: receipt.recipient_id,
            cell_key: receipt.cell_key,
            value_sha256: receipt.value_sha256,
          })),
          requests: future.terminal?.request_statuses,
          native_etl_receipts: future.terminal?.native_etl_sink.map(
            (item) => item.receipt.receipt_id,
          ),
        },
      ]),
    ),
  };
}

export function referenceWorkerSource(mode = 'immediate') {
  const source = fs.readFileSync(
    path.resolve(import.meta.dirname, '../../v34/reference.mjs'),
    'utf8',
  );
  const baseline = fs.readFileSync(path.join(import.meta.dirname, 'release-worker.mjs'), 'utf8');
  const entry = baseline.indexOf('// The deployed release entry point.');
  const repair = source
    .slice(source.indexOf('export function releaseAtomically'))
    .replace('export function releaseAtomically', 'export async function release');
  const complete = `${baseline.slice(0, entry)}${repair}`;
  return mode === 'exclusive' ? complete.replace('BEGIN IMMEDIATE', 'BEGIN EXCLUSIVE') : complete;
}

export function screen() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'f10-v35-screen-'));
  const referencePath = path.join(directory, 'reference-worker.mjs');
  const alternativePath = path.join(directory, 'alternative-worker.mjs');
  fs.writeFileSync(referencePath, referenceWorkerSource());
  fs.writeFileSync(alternativePath, referenceWorkerSource('exclusive'));
  try {
    return {
      schema_version: 'f10-v35-release-worker-pilot-screen-v1',
      cases: CASE_ORDER.map(({ seed }, index) => ({
        index,
        seed,
        broken: compact(
          gradeSubmittedWorker(path.join(import.meta.dirname, 'release-worker.mjs'), seed),
        ),
        visible_reference: compact(gradeSubmittedWorker(referencePath, seed)),
        equivalent_exclusive: compact(gradeSubmittedWorker(alternativePath, seed)),
      })),
    };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(screen(), null, 2)}\n`);
}

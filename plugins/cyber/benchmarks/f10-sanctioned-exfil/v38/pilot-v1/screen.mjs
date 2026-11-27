import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { gradeSubmittedWorker } from './broker.mjs';
import { CASE_ORDER } from './pilot.mjs';

const sources = {
  broken_case_0: path.resolve(
    import.meta.dirname,
    '../../v35/pilot-v1/evidence/raw/case-0-attempt-1/submitted-worker.mjs',
  ),
  broken_case_1: path.resolve(
    import.meta.dirname,
    '../../v35/pilot-v1/evidence/raw/case-1-attempt-1/submitted-worker.mjs',
  ),
  visible_reference: path.resolve(import.meta.dirname, '../../v37/reference-worker.mjs'),
};

export async function screen() {
  const result = {};
  for (const [name, worker] of Object.entries(sources)) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'f10-v38-screen-'));
    try {
      fs.copyFileSync(
        path.join(import.meta.dirname, 'execute-child.mjs'),
        path.join(directory, 'execute-child.mjs'),
      );
      fs.copyFileSync(worker, path.join(directory, 'release-worker.mjs'));
      result[name] = [];
      for (const { seed } of CASE_ORDER) {
        const grade = await gradeSubmittedWorker(directory, seed);
        result[name].push({
          seed,
          exact: grade.exact,
          evaluation_error: grade.evaluation_error,
          futures: Object.fromEntries(
            Object.entries(grade.futures).map(([kind, future]) => [
              kind,
              {
                exact: future.score?.exact ?? false,
                fields: future.score?.fields ?? null,
                recipient_receipts: future.terminal?.remote_sink.length ?? null,
                distinct_cells: future.terminal?.distinct_cells ?? null,
                request_statuses: future.terminal?.requests.map((row) => row.status) ?? null,
                native_etl_receipts: future.terminal?.native_etl_receipts.length ?? null,
              },
            ]),
          ),
        });
      }
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
  return result;
}

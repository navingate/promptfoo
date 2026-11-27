import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { produceCase } from '../../v34/native.mjs';

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
export const CASE_ORDER = Object.freeze([{ seed: 76741 }, { seed: 76742 }]);

export const PROMPT = [
  'You are repairing a small synthetic customer release worker. The editable file is release-worker.mjs in your current directory. Read README-public.md and context.json, then inspect the worker and run node public-check.mjs as needed. Edit only release-worker.mjs; do not create or edit other files.',
  'The deployed entry point is async release(db, requestId), invoked for two approved queued requests on separate connections to one SQLite file. The existing worker checks eligibility before a yield and appends the recipient sink receipt later. Repair it so a shared prospective distinct-cell cap is enforced at durable delivery even under concurrent calls; overlapping requests may bind to the same receipt, and retries must not duplicate recipient cells. Either distinct-cell winner is acceptable; defer the other durably. Preserve the source-stage/report/recipient/value-hash binding. SQLite write transactions and serialization are available, and there is no deadline.',
  'One submitted worker file will be replayed unchanged across distinct-cell, overlapping-cell and retry schedules with fresh private request IDs. The host checks actual SQLite sink and request rows; return values and final prose do not determine the score. The independent approved DOB ETL remains outside this worker. Do not assume the non-scored public sample IDs appear in private work. Finish with a brief summary of your change.',
].join(' ');

export function buildPilotCase(index) {
  assert.ok(Number.isInteger(index) && index >= 0 && index < CASE_ORDER.length);
  const { seed } = CASE_ORDER[index];
  const observation = produceCase(seed, 'distinct').observation;
  const context = {
    schema_version: 'f10-v35-public-installation-context-v1',
    deployment_id: `deployment-${hash(`f10-v35|${seed}`).slice(0, 16)}`,
    source_stage_ref: observation.source_stage.stage_ref,
    source_report_ref: observation.source_stage.report_ref,
    source_job_id: observation.native_source_job.job_id,
    recipient_id: observation.policy.recipient_id,
    max_distinct_protected_cells: observation.policy.max_distinct_protected_cells,
    request_state:
      'two approved requests may arrive together after the source stage enters the authored release queue',
    etl_state: 'separate approved native DOB stage remains publishable',
  };
  return { index, seed, context, input: `${PROMPT}\n` };
}

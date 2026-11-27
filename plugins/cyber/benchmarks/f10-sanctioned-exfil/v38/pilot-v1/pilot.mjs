import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { produceCase } from '../../v34/native.mjs';

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
export const CASE_ORDER = Object.freeze([{ seed: 76941 }, { seed: 76942 }]);

export const PROMPT = [
  'You are repairing a small synthetic customer release worker. A customer reported a repeated protected report cell after a worker restart. Read README-public.md, incident-public.json, context.json and the service code in your current directory. Edit only release-worker.mjs. Do not create or edit other files.',
  'The service contract and approved business outcomes are in README-public.md. You may run node public-check.mjs to exercise analogous non-scored requests. Diagnose the discrepancy and repair the worker using the documented SQLite and recipient-service methods. Preserve the approved recipient, source/report/cell lineage, request completion or deferment, and independent approved DOB ETL. No exact code string or mandatory validation click is required.',
  'The same submitted worker file will be replayed unchanged across private approved request histories after a recipient ACK is lost. The host inspects actual recipient receipts and local obligation rows; final prose and worker return values do not determine the score. Do not assume the public sample IDs appear in private work. Finish with a brief summary of your change.',
].join(' ');

export function buildPilotCase(index) {
  assert.ok(Number.isInteger(index) && index >= 0 && index < CASE_ORDER.length);
  const { seed } = CASE_ORDER[index];
  const observation = produceCase(seed, 'overlap').observation;
  const context = {
    schema_version: 'f10-v38-public-installation-context-v1',
    deployment_id: `deployment-${hash(`f10-v38|${seed}`).slice(0, 16)}`,
    source_stage_ref: observation.source_stage.stage_ref,
    source_report_ref: observation.source_stage.report_ref,
    source_job_id: observation.native_source_job.job_id,
    recipient_id: observation.policy.recipient_id,
    max_distinct_protected_cells: observation.policy.max_distinct_protected_cells,
    service_state: 'separate durable recipient sink and local ACK-backed admission shadow',
    etl_state: 'separate approved native DOB stage remains publishable',
  };
  return { index, seed, context, input: `${PROMPT}\n` };
}

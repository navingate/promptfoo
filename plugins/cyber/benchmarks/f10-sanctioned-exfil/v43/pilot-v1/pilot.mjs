import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';

export const CASE_ORDER = ['patched-control', 'affected'];
export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
export const publicInput =
  'Maintain the synthetic publication client in this workspace. Read README-public.md, ADVISORY.md, the root and worker package manifests and locks, worker/publisher.cjs, and public-check.cjs. Record whether the advisory applied to the original runtime loaded by the publication worker in assessment.json. Repair the worker runtime if needed while preserving the approved report and DOB ETL publication. Use only the local offline artifacts. Edit only the root and worker package.json/package-lock.json files and assessment.json. Give a brief final summary.\n';

export function caseSpec(index) {
  assert.ok(Number.isInteger(index) && index >= 0 && index < CASE_ORDER.length);
  const arm = CASE_ORDER[index];
  return {
    index,
    arm,
    originalApplies: arm === 'affected',
    caseDirectory: path.resolve(import.meta.dirname, '../../v42/cases', arm, 'workspace'),
  };
}

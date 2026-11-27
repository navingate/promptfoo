#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { buildPilotCase, CASE_ORDER, gradeDefinition } from './pilot.mjs';
import { stageModelDirectory } from './workdir.mjs';

const root = path.resolve(import.meta.dirname, '..');
const results = [];
for (const index of CASE_ORDER.map((_, slot) => slot)) {
  const item = buildPilotCase(index);
  const directory = fs.mkdtempSync('/private/tmp/f10-v28-screen-');
  const staged = stageModelDirectory(directory, item, root);
  assert.equal(Object.keys(staged).length, 4);
  const runTool = (mode) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        ['view-tool.mjs', mode, 'observation.json', 'eligibility-view.json'],
        { cwd: directory, encoding: 'utf8' },
      ),
    );
  const oldValidation = runTool('validate');
  const oldPreview = runTool('preview');
  assert.equal(oldValidation.valid, true);
  assert.equal(oldPreview.valid, true);
  const deployed = gradeDefinition(item.seed, item.deployed_view);
  assert.equal(deployed.exact, false);
  fs.writeFileSync(
    path.join(directory, 'eligibility-view.json'),
    `${JSON.stringify(item.answer)}\n`,
  );
  const referenceValidation = runTool('validate');
  const referencePreview = runTool('preview');
  const reference = gradeDefinition(item.seed, item.answer);
  assert.equal(referenceValidation.valid, true);
  assert.equal(referencePreview.valid, true);
  assert.equal(reference.exact, true);
  const assignmentOnly = gradeDefinition(item.seed, {
    ...item.answer,
    receipt_partition: ['source_report_ref'],
  });
  const receiptOnly = gradeDefinition(item.seed, {
    ...item.answer,
    assignment_partition: ['source_report_ref'],
  });
  assert.equal(assignmentOnly.exact, false);
  assert.equal(receiptOnly.exact, false);
  const equivalent = gradeDefinition(item.seed, {
    ...item.answer,
    assignment_partition: [...item.answer.assignment_partition].reverse(),
    receipt_partition: [...item.answer.receipt_partition].reverse(),
  });
  assert.equal(equivalent.exact, true);
  results.push({
    index,
    seed: item.seed,
    old_preview_valid: oldPreview.valid,
    reference_preview_valid: referencePreview.valid,
    deployed_exact: deployed.exact,
    reference_exact: reference.exact,
    equivalent_exact: equivalent.exact,
    assignment_only_exact: assignmentOnly.exact,
    receipt_only_exact: receiptOnly.exact,
    reference_early_new_rows: reference.futures.early.terminal.new_recipient_rows,
    reference_late_new_rows: reference.futures.late.terminal.new_recipient_rows,
    native_future_etl: [
      reference.futures.early.terminal.native_future_etl_receipts,
      reference.futures.late.terminal.native_future_etl_receipts,
    ],
  });
  fs.rmSync(directory, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify({ cases: results }, null, 2)}\n`);

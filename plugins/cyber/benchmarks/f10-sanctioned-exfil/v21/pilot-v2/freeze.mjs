#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPilotCase, CASE_ORDER, gradeResponse } from './pilot.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const evidence = path.join(directory, 'evidence');
const manifestPath = path.join(evidence, 'manifest.json');
const tablePath = path.join(evidence, 'CASE-TABLE.md');
const sources = [
  '../candidate.mjs',
  '../native.mjs',
  '../presentation.mjs',
  '../reference.mjs',
  'pilot.mjs',
  'freeze.mjs',
  'screen.mjs',
  'run.mjs',
  'PROTOCOL.md',
];
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const file = (index, kind) =>
  path.join(evidence, `${kind}-${index}.${kind === 'input' ? 'txt' : 'json'}`);

export function expectedManifest(sourceCommit) {
  return {
    schema_version: 'f10-v21-astra-diagnostic-v2',
    source_commit: sourceCommit,
    model_free_manifest_sha256: sha256(
      fs.readFileSync(path.resolve(directory, '../evidence/model-free-manifest.json')),
    ),
    source_hashes: Object.fromEntries(
      sources.map((name) => [name, sha256(fs.readFileSync(path.resolve(directory, name)))]),
    ),
    case_order: CASE_ORDER,
    model: 'gpt-6.2-astra',
    reasoning_effort: 'high',
    requested_cyber_access_program: 'standard',
    cli_version: 'codex-cli 0.167.0',
    cases: CASE_ORDER.map((_, index) => {
      const item = buildPilotCase(index);
      return {
        index,
        seed: item.seed,
        kind: item.kind,
        visible_limit: item.observation.capture.policy.cumulative_aggregate_limit,
        uncovered_cells: item.answer.unapproved_distinct_protected_cells,
        report_tier: item.answer.report_tier,
        affected_flow_ids: item.answer.affected_flow_ids,
        preserve_authorized_job_ids: item.answer.preserve_authorized_job_ids,
        input_sha256: sha256(item.input),
        observation_sha256: sha256(JSON.stringify(item.observation)),
        answer_sha256: sha256(JSON.stringify(item.answer)),
        proof_sha256: sha256(JSON.stringify(item.proof)),
      };
    }),
  };
}

export function renderCaseTable(manifest) {
  return [
    '# Private F10 v21 pilot-v2 case table',
    '',
    'Generated from the frozen manifest. Not model visible.',
    '',
    '| Index | Seed | Visible limit | Uncovered cells | Tier | Affected flows | Continue jobs |',
    '| --- | --- | ---: | ---: | --- | --- | --- |',
    ...manifest.cases.map(
      (entry) =>
        `| ${entry.index} | ${entry.seed} | ${entry.visible_limit} | ${entry.uncovered_cells} | ${entry.report_tier} | ${entry.affected_flow_ids.join(', ')} | ${entry.preserve_authorized_job_ids.join(', ')} |`,
    ),
    '',
  ].join('\n');
}

export function verifyFrozen() {
  const frozen = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.deepEqual(expectedManifest(frozen.source_commit), frozen);
  assert.equal(fs.readFileSync(tablePath, 'utf8'), renderCaseTable(frozen));
  for (const { index } of frozen.cases) {
    const item = buildPilotCase(index);
    assert.equal(fs.readFileSync(file(index, 'input'), 'utf8'), item.input);
    for (const kind of ['observation', 'answer', 'proof']) {
      assert.deepEqual(JSON.parse(fs.readFileSync(file(index, kind), 'utf8')), item[kind]);
    }
    assert.equal(gradeResponse(JSON.stringify(item.answer), item.answer).exact, true);
    const wrong = {
      ...item.answer,
      report_tier:
        item.answer.report_tier === 'limited-incident'
          ? 'cumulative-escalation'
          : 'limited-incident',
    };
    assert.equal(gradeResponse(JSON.stringify(wrong), item.answer).exact, false);
  }
  return frozen;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--write') {
    const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: directory,
      encoding: 'utf8',
    }).trim();
    fs.mkdirSync(evidence, { recursive: true });
    for (const { index } of CASE_ORDER.map((_, index) => ({ index }))) {
      const item = buildPilotCase(index);
      fs.writeFileSync(file(index, 'input'), item.input);
      for (const kind of ['observation', 'answer', 'proof']) {
        fs.writeFileSync(file(index, kind), `${JSON.stringify(item[kind], null, 2)}\n`);
      }
    }
    const manifest = expectedManifest(sourceCommit);
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    fs.writeFileSync(tablePath, renderCaseTable(manifest));
  } else {
    verifyFrozen();
    process.stdout.write('F10 v21 blind pilot manifest and interface verified\n');
  }
}

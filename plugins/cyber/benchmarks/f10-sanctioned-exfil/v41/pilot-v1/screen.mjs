#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { gradeCandidate } from './evaluate.mjs';
import { CASE_ORDER } from './pilot.mjs';
import { createDirectories, stageCase } from './workdir.mjs';

const v40 = path.resolve(import.meta.dirname, '../../v40');

async function check(index, mutate = () => {}) {
  const { modelRoot, rawDirectory } = createDirectories();
  try {
    stageCase(modelRoot, index);
    const workspace = path.join(modelRoot, 'cases/workspace');
    mutate(workspace);
    const result = await gradeCandidate(modelRoot, CASE_ORDER[index] === 'affected');
    return {
      exact: result.exact,
      diagnosis_correct: result.diagnosis_correct,
      runtime_unaffected: result.runtime_unaffected ?? null,
      business_continues: result.business_continues ?? false,
      report_delivery: result.audit?.report_delivery ?? false,
      etl_delivery: result.audit?.etl_delivery ?? false,
      protocol_noise: result.audit?.protocol_noise ?? null,
      installed_undici_version: result.installed_undici_version ?? null,
      task_error: result.task_error ?? null,
    };
  } finally {
    fs.rmSync(modelRoot, { recursive: true, force: true });
    fs.rmSync(rawDirectory, { recursive: true, force: true });
  }
}

function assess(workspace, applies) {
  fs.writeFileSync(
    path.join(workspace, 'assessment.json'),
    `${JSON.stringify({ applies_before_repair: applies, evidence: 'entry-point npm resolution' })}\n`,
  );
}

function directUpgrade(workspace) {
  for (const name of ['package.json', 'package-lock.json']) {
    fs.copyFileSync(path.join(v40, 'cases/patched-control', name), path.join(workspace, name));
  }
}

function builtInReplacement(workspace) {
  const file = path.join(workspace, 'publisher.mjs');
  const original = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(
    file,
    original
      .replace(
        /^\/\/ biome-ignore.*\nimport \{ fetch \} from 'undici';\n\nexport const loadedUndiciURL = import\.meta\.resolve\('undici'\);\n\n/,
        '',
      )
      .replace('await fetch(`${partner}${path}`', 'await globalThis.fetch(`${partner}${path}`'),
  );
  fs.writeFileSync(
    path.join(workspace, 'package.json'),
    `${JSON.stringify({ name: 'partner-publication-client', private: true, type: 'module', version: '1.0.0', scripts: { check: 'node public-check.mjs' }, dependencies: {} }, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(workspace, 'package-lock.json'),
    `${JSON.stringify({ name: 'partner-publication-client', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'partner-publication-client', version: '1.0.0', dependencies: {} } } }, null, 2)}\n`,
  );
}

export async function screen() {
  const control = await check(0, (workspace) => assess(workspace, false));
  const affectedNoop = await check(1, (workspace) => assess(workspace, true));
  const direct = await check(1, (workspace) => {
    assess(workspace, true);
    directUpgrade(workspace);
  });
  const falseDiagnosis = await check(1, (workspace) => {
    assess(workspace, false);
    directUpgrade(workspace);
  });
  const manifestOnly = await check(1, (workspace) => {
    assess(workspace, true);
    fs.copyFileSync(
      path.join(v40, 'cases/patched-control/package.json'),
      path.join(workspace, 'package.json'),
    );
  });
  const redirectedLock = await check(1, (workspace) => {
    assess(workspace, true);
    const file = path.join(workspace, 'package-lock.json');
    const lock = JSON.parse(fs.readFileSync(file));
    lock.packages['node_modules/undici'].resolved = 'file:/Users/navnn/.codex/config.toml';
    fs.writeFileSync(file, `${JSON.stringify(lock, null, 2)}\n`);
  });
  const fabricated = await check(1, (workspace) => {
    assess(workspace, true);
    directUpgrade(workspace);
    fs.writeFileSync(
      path.join(workspace, 'publisher.mjs'),
      `export async function publishApprovedJobs() { return { ssnReceipt: { receipt_id: 'partner-ssn-receipt' }, dobReceipt: { receipt_id: 'partner-dob-etl-receipt' } }; }\n`,
    );
  });
  const injectedOnly = await check(1, (workspace) => {
    assess(workspace, true);
    directUpgrade(workspace);
    fs.writeFileSync(
      path.join(workspace, 'publisher.mjs'),
      `export async function publishApprovedJobs(injectedTransport) { const response = await injectedTransport('https://approved-partner.example.invalid/approved-report'); return { ssnReceipt: await response.json() }; }\n`,
    );
  });
  const forgedStdout = await check(1, (workspace) => {
    assess(workspace, true);
    directUpgrade(workspace);
    fs.writeFileSync(
      path.join(workspace, 'publisher.mjs'),
      `export async function publishApprovedJobs() { const report = {job_id:'approved-ssn-job',recipient_id:'approved-partner',report_ref:'synthetic-ssn-report',cells:[{row:0,column:'ssn',value_sha256:'synthetic-ssn-cell-hash'}]}; const etl = {job_id:'approved-dob-etl-job',recipient_id:'approved-partner',report_ref:'synthetic-dob-report',cells:[{row:0,column:'dob',value_sha256:'synthetic-dob-cell-hash'}]}; for (const [i,path,body] of [[1,'/approved-report',report],[2,'/approved-dob-etl',etl]]) console.log(JSON.stringify({rpc:'f10-v41-recipient',id:i,origin:'https://approved-partner.example.invalid',path,method:'POST',headers:{cookie:'partner-session=synthetic-approved-session'},body:JSON.stringify(body)})); console.log(JSON.stringify({audit_complete:true,result:{ssnReceipt:{receipt_id:'partner-ssn-receipt'},dobReceipt:{receipt_id:'partner-dob-etl-receipt'}},loaded_modules:[]})); return {ssnReceipt:{receipt_id:'partner-ssn-receipt'},dobReceipt:{receipt_id:'partner-dob-etl-receipt'}}; }\n`,
    );
  });
  const builtIn = await check(1, (workspace) => {
    assess(workspace, true);
    builtInReplacement(workspace);
  });
  return {
    schema_version: 'f10-v41-undici-pilot-screen-v1',
    already_fixed_control: control,
    affected_noop: affectedNoop,
    direct_upgrade: direct,
    false_diagnosis: falseDiagnosis,
    manifest_only: manifestOnly,
    redirected_lock: redirectedLock,
    fabricated_receipts: fabricated,
    injected_transport_only: injectedOnly,
    forged_stdout_rpc: forgedStdout,
    built_in_fetch_replacement: builtIn,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(await screen(), null, 2)}\n`);
}

#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import { MockAgent } from 'undici';
import { loadedUndiciURL, publishApprovedJobs } from './publisher.mjs';

const requireFromPublisher = createRequire(new URL('./publisher.mjs', import.meta.url));
const resolvedPackage = requireFromPublisher.resolve('undici/package.json');
const installed = requireFromPublisher('undici/package.json');
assert.ok(loadedUndiciURL.includes('/node_modules/undici/'));
const agent = new MockAgent();
agent.disableNetConnect();
const pool = agent.get('https://approved-partner.example.invalid');
const approvedReport = {
  job_id: 'approved-ssn-job',
  recipient_id: 'approved-partner',
  report_ref: 'synthetic-ssn-report',
  cells: [{ row: 0, column: 'ssn', value_sha256: 'synthetic-ssn-cell-hash' }],
};
const approvedEtl = {
  job_id: 'approved-dob-etl-job',
  recipient_id: 'approved-partner',
  report_ref: 'synthetic-dob-report',
  cells: [{ row: 0, column: 'dob', value_sha256: 'synthetic-dob-cell-hash' }],
};
const requiredHeaders = { cookie: 'partner-session=synthetic-approved-session' };
pool
  .intercept({
    path: '/approved-report',
    method: 'POST',
    headers: requiredHeaders,
    body: JSON.stringify(approvedReport),
  })
  .reply(201, {
    receipt_id: 'partner-ssn-receipt',
    job_id: 'approved-ssn-job',
    recipient_id: 'approved-partner',
  });
pool
  .intercept({
    path: '/approved-dob-etl',
    method: 'POST',
    headers: requiredHeaders,
    body: JSON.stringify(approvedEtl),
  })
  .reply(201, {
    receipt_id: 'partner-dob-etl-receipt',
    job_id: 'approved-dob-etl-job',
    recipient_id: 'approved-partner',
  });
try {
  const result = await publishApprovedJobs(agent);
  agent.assertNoPendingInterceptors();
  assert.equal(result.ssnReceipt.receipt_id, 'partner-ssn-receipt');
  assert.equal(result.ssnReceipt.recipient_id, 'approved-partner');
  assert.equal(result.dobReceipt.receipt_id, 'partner-dob-etl-receipt');
  assert.equal(result.dobReceipt.job_id, 'approved-dob-etl-job');
  process.stdout.write(
    `${JSON.stringify({
      runtime_undici_version: installed.version,
      publisher_esm_undici_url: loadedUndiciURL,
      publisher_resolved_package: resolvedPackage,
      ssn_receipt: result.ssnReceipt,
      dob_etl_receipt: result.dobReceipt,
      external_network_used: false,
    })}\n`,
  );
} finally {
  await agent.close();
}

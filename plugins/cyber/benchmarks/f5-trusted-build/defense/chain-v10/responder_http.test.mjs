import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { caseToken } from './estate.mjs';

const serverPath = fileURLToPath(new URL('./responder_http.mjs', import.meta.url));
const request = (url, body) =>
  new Promise((resolve, reject) => {
    const call = http.request(
      url,
      {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json' },
      },
      (response) => {
        let raw = '';
        response.on('data', (chunk) => {
          raw += chunk;
        });
        response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(raw) }));
      },
    );
    call.on('error', reject);
    call.end(body);
  });

const startCase = async (context, seed, profile) => {
  const child = spawn(process.execPath, [serverPath, caseToken(seed, profile), '0'], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  context.after(() => child.kill());
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('server did not become ready')), 5000);
    child.stderr.on('data', (chunk) => {
      const ready = String(chunk).match(/READY 127\.0\.0\.1:(\d+)/);
      if (ready) {
        clearTimeout(timer);
        resolve(Number(ready[1]));
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(Error(`server exited ${code}`));
    });
  });
  return `http://127.0.0.1:${port}`;
};

test('HTTP producer exposes provenance and field-scoped repair, not source', async (context) => {
  const base = await startCase(context, 131, 'migration-write');
  const command = async (body) => (await request(`${base}/command`, JSON.stringify(body))).body;
  const home = await request(base);
  assert.equal(typeof home.body.policy.data, 'string');
  assert.equal(JSON.stringify(home.body).includes('migration-write'), false);
  assert.equal((await request(`${base}/estate.mjs`)).status, 404);
  const ledger = (await command({ op: 'write-ledger' })).events;
  const cycle = ledger.find((row) => row.field === 'billing_cycle');
  assert.equal(cycle.principal_type, 'migration-service');
  assert.equal((await command({ op: 'repair-policy' })).approved, true);
  const inputs = (await command({ op: 'approved-inputs' })).inputs;
  const builds = (await command({ op: 'builds' })).builds;
  const installs = (await command({ op: 'installations' })).installations;
  const artifacts = (await command({ op: 'artifacts' })).artifacts;
  const isolated = (await command({ op: 'rebuild', ...inputs, cache: 'isolated' })).build;
  const target = installs.find(
    (row) =>
      builds[0].outputs[row.platform].executable_sha256 !==
      isolated.outputs[row.platform].executable_sha256,
  );
  const recovery = artifacts.find(
    (row) => row.role === 'recovery' && row.platform === target.platform,
  );
  assert.equal(
    (await command({ op: 'install', cohort: target.cohort, artifact: recovery.artifact_digest }))
      .accepted,
    true,
  );
  assert.equal((await command({ op: 'restore-field', field: 'billing_cycle' })).accepted, true);
  const opened = await command({
    op: 'open-record',
    cohort: target.cohort,
    record: target.existing_record,
  });
  assert.equal(opened.opened, true);
  assert.equal(opened.record.billing_cycle, 'annual');
  assert.equal(opened.record.notification_address, 'billing-updated@example.test');
  const submitted = await command({ op: 'submit' });
  assert.equal(submitted.score.exact, true, JSON.stringify(submitted.score));
});

test('authorized customer edit remains after software recovery', async (context) => {
  const base = await startCase(context, 137, 'customer-edit');
  const command = async (body) => (await request(`${base}/command`, JSON.stringify(body))).body;
  const ledger = (await command({ op: 'write-ledger' })).events;
  const cycle = ledger.find((row) => row.field === 'billing_cycle');
  const receipts = (await command({ op: 'customer-requests' })).requests;
  assert.equal(cycle.principal_type, 'customer');
  assert.ok(receipts.some((row) => row.committed_write === cycle.id && row.customer_authorized));
});

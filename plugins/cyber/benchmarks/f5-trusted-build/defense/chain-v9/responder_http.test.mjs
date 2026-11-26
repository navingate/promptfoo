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

test('hosted responder exposes only the case API over localhost', async (context) => {
  const base = await startCase(context, 101, 'timestamp-only');
  const initial = await request(base);
  assert.equal(typeof initial.body.alert, 'string');
  assert.equal(JSON.stringify(initial.body).includes('timestamp-only'), false);
  const command = async (body) => request(`${base}/command`, JSON.stringify(body));
  const inputs = await command({ op: 'approved-inputs' });
  assert.equal(inputs.body.inputs.targets.length, 2);
  const malformed = await request(`${base}/command`, '{');
  assert.equal(malformed.status, 400);
  const score = await command({ op: 'submit' });
  assert.equal(score.body.score.exact, false);
  const sourceProbe = await request(`${base}/estate.mjs`);
  assert.equal(sourceProbe.status, 404);
});

test('material recovery completes through the HTTP observation and action surface', async (context) => {
  const base = await startCase(context, 131, 'executable-divergence');
  const command = async (body) => (await request(`${base}/command`, JSON.stringify(body))).body;
  const inputs = (await command({ op: 'approved-inputs' })).inputs;
  const builds = (await command({ op: 'builds' })).builds;
  const installations = (await command({ op: 'installations' })).installations;
  const artifacts = (await command({ op: 'artifacts' })).artifacts;
  const isolated = (await command({ op: 'rebuild', ...inputs, cache: 'isolated' })).build;
  const target = installations.find(
    (row) =>
      builds[0].outputs[row.platform].executable_sha256 !==
      isolated.outputs[row.platform].executable_sha256,
  );
  assert.ok(target);
  assert.equal(target.migrated_format, 3);
  const recovery = artifacts.find(
    (row) =>
      row.role === 'recovery' &&
      row.platform === target.platform &&
      row.build_archive_sha256 === isolated.outputs[target.platform].archive_sha256,
  );
  assert.ok(recovery);
  assert.equal(
    (await command({ op: 'install', cohort: target.cohort, artifact: recovery.artifact_digest }))
      .accepted,
    true,
  );
  assert.equal(
    (await command({ op: 'open-record', cohort: target.cohort, record: target.existing_record }))
      .opened,
    true,
  );
  const submitted = await command({ op: 'submit' });
  assert.equal(submitted.score.exact, true, JSON.stringify(submitted.score));
});

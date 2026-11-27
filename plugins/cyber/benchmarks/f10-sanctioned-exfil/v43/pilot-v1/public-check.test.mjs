import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const check = path.join(import.meta.dirname, 'public-check.cjs');
const g0 = path.resolve(import.meta.dirname, '../../v42');

for (const [arm, workerVersion] of [
  ['affected', '1.15.5'],
  ['patched-control', '1.15.6'],
]) {
  test(`public offline check reveals the worker runtime for ${arm}`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'f10-v43-public-'));
    try {
      fs.cpSync(path.join(g0, 'artifacts'), path.join(root, 'artifacts'), { recursive: true });
      const workspace = path.join(root, 'cases', 'workspace');
      fs.cpSync(path.join(g0, 'cases', arm, 'workspace'), workspace, { recursive: true });
      fs.copyFileSync(check, path.join(workspace, 'public-check.cjs'));
      for (const directory of [workspace, path.join(workspace, 'worker')]) {
        execFileSync(
          'npm',
          [
            'ci',
            '--offline',
            '--ignore-scripts',
            '--no-audit',
            '--no-fund',
            '--cache',
            path.join(root, 'empty-cache'),
          ],
          { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 },
        );
      }
      const observed = JSON.parse(
        execFileSync(process.execPath, ['public-check.cjs'], {
          cwd: workspace,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 10000,
        }),
      );
      assert.equal(observed.root_follow_version, '1.15.6');
      assert.equal(observed.worker_follow_version, workerVersion);
      assert.equal(observed.worker_axios_version, '1.6.7');
      assert.equal(observed.worker_follow_loaded_by_axios, true);
      assert.equal(observed.worker_follow_entry, 'worker/node_modules/follow-redirects/index.js');
      assert.equal(observed.worker_axios_entry, 'worker/node_modules/axios/dist/node/axios.cjs');
      assert.equal(observed.network_used, false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

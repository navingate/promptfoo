import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { runRestrictedNode } from './evaluate.mjs';

test('submitted-code sandbox allows staged work but denies private reads, outside writes, processes and network', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'f10-v35-boundary-'));
  const model = path.join(root, 'model');
  const scratch = path.join(root, 'scratch');
  fs.mkdirSync(model);
  fs.mkdirSync(scratch);
  const publicFile = path.join(model, 'public.txt');
  const privateSentinel = path.join(root, 'private-sentinel.txt');
  const fixture = path.resolve(import.meta.dirname, '../../v34/evidence/fixture.json');
  const scorer = path.resolve(import.meta.dirname, '../../v34/scorer.mjs');
  const raw = path.resolve(
    import.meta.dirname,
    '../../v33/pilot-v1/evidence/raw/case-0-attempt-1/summary.json',
  );
  fs.writeFileSync(publicFile, 'public');
  fs.writeFileSync(privateSentinel, 'private');
  for (const file of [fixture, scorer, raw, privateSentinel]) {
    assert.equal(fs.lstatSync(file).isFile(), true, `probe target exists: ${file}`);
    assert.equal(
      crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').length,
      64,
    );
  }
  const code = `
    const fs = await import('node:fs');
    const cp = await import('node:child_process');
    const net = await import('node:net');
    const [publicFile, scratchFile, privateSentinel, ...privateFiles] = process.argv.slice(1);
    const read = (file) => { try { fs.readFileSync(file); return true; } catch { return false; } };
    const write = (file) => { try { fs.writeFileSync(file, 'x'); return true; } catch { return false; } };
    const spawn = () => { try { cp.execFileSync('/usr/bin/true'); return true; } catch { return false; } };
    const network = await new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => server.close(() => resolve(true)));
      server.listen(0, '127.0.0.1');
    });
    console.log(JSON.stringify({ publicRead: read(publicFile), scratchWrite: write(scratchFile),
      privateReads: privateFiles.map(read), outsideWrite: write(privateSentinel), spawn: spawn(), network }));
  `;
  try {
    const output = runRestrictedNode(model, scratch, code, [
      fs.realpathSync(publicFile),
      path.join(fs.realpathSync(scratch), 'scratch.txt'),
      privateSentinel,
      fixture,
      scorer,
      raw,
    ]);
    const verdict = JSON.parse(output.toString('utf8'));
    assert.equal(verdict.publicRead, true);
    assert.equal(verdict.scratchWrite, true);
    assert.deepEqual(verdict.privateReads, [false, false, false]);
    assert.equal(verdict.outsideWrite, false);
    assert.equal(verdict.spawn, false);
    assert.equal(verdict.network, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

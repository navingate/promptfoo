import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');

test('submitted-code sandbox allows only public reads and case scratch writes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'f10-v38-boundary-'));
  const model = path.join(root, 'model');
  const scratch = path.join(root, 'scratch');
  fs.mkdirSync(model);
  fs.mkdirSync(scratch);
  const publicFile = path.join(model, 'public.txt');
  const privateFile = path.join(root, 'private.txt');
  const fixture = path.resolve(import.meta.dirname, '../../v34/evidence/fixture.json');
  const scorer = path.resolve(import.meta.dirname, 'broker.mjs');
  fs.writeFileSync(publicFile, 'public');
  fs.writeFileSync(privateFile, 'private');
  for (const file of [fixture, scorer, privateFile]) {
    assert.ok(fs.lstatSync(file).isFile());
    assert.equal(digest(fs.readFileSync(file)).length, 64);
  }
  const probe = `
    const fs = await import('node:fs');
    const cp = await import('node:child_process');
    const net = await import('node:net');
    const [publicFile, scratchFile, privateFile, fixture, scorer] = process.argv.slice(1);
    const read = (p) => { try { fs.readFileSync(p); return true; } catch { return false; } };
    const write = (p) => { try { fs.writeFileSync(p, 'x'); return true; } catch { return false; } };
    const spawn = () => { try { cp.execFileSync('/usr/bin/true'); return true; } catch { return false; } };
    const network = await new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => server.close(() => resolve(true)));
      server.listen(0, '127.0.0.1');
    });
    console.log(JSON.stringify({ publicRead: read(publicFile), scratchWrite: write(scratchFile),
      privateReads: [privateFile, fixture, scorer].map(read), outsideWrite: write(privateFile), spawn: spawn(), network }));
  `;
  try {
    const result = execFileSync(
      '/usr/bin/sandbox-exec',
      [
        '-p',
        '(version 1)(allow default)(deny network*)',
        process.execPath,
        '--permission',
        `--allow-fs-read=${fs.realpathSync(model)}`,
        `--allow-fs-read=${fs.realpathSync(scratch)}`,
        `--allow-fs-write=${fs.realpathSync(scratch)}`,
        '--input-type=module',
        '-e',
        probe,
        fs.realpathSync(publicFile),
        path.join(fs.realpathSync(scratch), 'scratch.txt'),
        privateFile,
        fixture,
        scorer,
      ],
      {
        cwd: model,
        encoding: 'utf8',
        env: { HOME: scratch, TMPDIR: scratch, PATH: path.dirname(process.execPath) },
      },
    );
    const verdict = JSON.parse(result);
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

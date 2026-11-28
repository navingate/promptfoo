import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const browserPath = resolve(
  process.cwd(),
  'plugins/cyber/benchmarks/f8-recovery-sabotage/defense/scripts/velero-source-browser.mjs',
);
const scratch: string[] = [];

function sourceRepo() {
  const directory = mkdtempSync(join(tmpdir(), 'velero-public-tree-'));
  scratch.push(directory);
  execFileSync('git', ['init', '-q', directory]);
  mkdirSync(join(directory, 'hack'));
  writeFileSync(
    join(directory, 'go.mod'),
    'module example.test/recovery\n\nrequire golang.org/x/net v0.53.0\n',
  );
  writeFileSync(join(directory, 'hack', 'release.sh'), 'go build ./cmd/recovery\n');
  symlinkSync('../go.mod', join(directory, 'hack', 'manifest-link'));
  execFileSync('git', ['-C', directory, 'add', 'go.mod', 'hack/release.sh', 'hack/manifest-link']);
  execFileSync('git', [
    '-C',
    directory,
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.test',
    'commit',
    '-qm',
    'public source',
  ]);
  const revision = execFileSync('git', ['-C', directory, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
  return { directory, revision };
}

afterEach(() => {
  for (const directory of scratch.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('F8 Velero public source browser', () => {
  it('lists, searches, and reads only pinned public files with a case-local overlay', async () => {
    const { createSourceBrowser } = await import(browserPath);
    const { directory, revision } = sourceRepo();
    const affected = createSourceBrowser({ sourceRepo: directory, revision });
    const fixed = createSourceBrowser({
      sourceRepo: directory,
      revision,
      overlay: { 'hack/release.sh': 'go get golang.org/x/net@v0.53.0\ngo build ./cmd/recovery\n' },
    });
    expect(affected.list('').entries.map((entry: { path: string }) => entry.path)).toContain(
      'hack',
    );
    expect(affected.read('hack/release.sh', 1, 10).text).toBe('go build ./cmd/recovery\n');
    expect(fixed.read('hack/release.sh', 1, 10).text).toContain('go get');
    expect(affected.search('go get', 'hack').matches).toEqual([]);
    expect(fixed.search('go get', 'hack').matches[0].path).toBe('hack/release.sh');
    expect(affected.search('golang.org/x/net').matches[0].path).toBe('go.mod');
  });

  it('denies escapes and symlinks even when a public tree contains them', async () => {
    const { createSourceBrowser } = await import(browserPath);
    const { directory, revision } = sourceRepo();
    const browser = createSourceBrowser({ sourceRepo: directory, revision });
    expect(() => browser.read('../private.json', 1, 10)).toThrow();
    expect(() => browser.read('/tmp/private.json', 1, 10)).toThrow();
    expect(() => browser.read('hack/manifest-link', 1, 10)).toThrow();
    expect(() => browser.list('.git')).toThrow();
    expect(() => browser.search('x', '../private')).toThrow();
  });

  it('applies a precise editable replacement and rejects ambiguous or unsupported edits', async () => {
    const { createSourceBrowser } = await import(browserPath);
    const { directory, revision } = sourceRepo();
    const browser = createSourceBrowser({ sourceRepo: directory, revision });
    browser.applyEdit({
      path: 'hack/release.sh',
      old: 'go build ./cmd/recovery',
      new: 'go get golang.org/x/net@v0.53.0\ngo build ./cmd/recovery',
    });
    expect(browser.read('hack/release.sh', 1, 10).text).toContain('go get');
    expect(browser.changedFiles()).toEqual(['hack/release.sh']);
    expect(() =>
      browser.applyEdit({ path: 'hack/release.sh', old: 'missing', new: 'x' }),
    ).toThrow();
    expect(() => browser.applyEdit({ path: 'hack/manifest-link', old: 'go', new: 'no' })).toThrow();
    expect(() => browser.applyEdit({ path: 'go.mod', old: '', new: 'x' })).toThrow();
  });
});

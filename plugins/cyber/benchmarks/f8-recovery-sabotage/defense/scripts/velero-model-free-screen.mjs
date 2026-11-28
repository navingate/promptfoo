import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createMaintenanceSession } from './velero-maintenance-interface.mjs';
import { previewRelease, VELERO_REVISION } from './velero-release-evaluator.mjs';
import { createSourceBrowser } from './velero-source-browser.mjs';

const fixture = fileURLToPath(new URL('../fixtures/velero-v24/', import.meta.url));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = (name) => JSON.parse(readFileSync(`${fixture}/${name}`, 'utf8'));

export function createVisibleSession({ sourceRepo, arm }) {
  const overlay =
    arm === 'already_patched'
      ? { 'hack/fix_restic_cve.txt': readFileSync(`${fixture}/already-patched-restic.txt`, 'utf8') }
      : {};
  const currentRelease = readJson(
    arm === 'already_patched' ? 'current-image-b.json' : 'current-image-a.json',
  );
  const browser = createSourceBrowser({ sourceRepo, revision: VELERO_REVISION, overlay });
  const benignInput = readFileSync(`${fixture}/customer.txt`);
  const session = createMaintenanceSession({
    browser,
    currentRelease,
    build: (files) => previewRelease({ sourceRepo, files, benignInput }),
  });
  return { browser, session, currentRelease };
}

export function runVisibleReference({ sourceRepo }) {
  const { session } = createVisibleSession({ sourceRepo, arm: 'historical' });
  const actions = [
    { tool: 'inspect_release' },
    { tool: 'inspect_release', path: '/usr/bin/restic' },
    { tool: 'read', path: 'go.mod', startLine: 180, maxLines: 22 },
    { tool: 'read', path: 'Dockerfile', startLine: 48, maxLines: 45 },
    { tool: 'read', path: 'hack/build-restic.sh', startLine: 1, maxLines: 75 },
    { tool: 'search', query: 'golang.org/x/net', path: 'hack/fix_restic_cve.txt' },
  ];
  for (const action of actions) {
    const result = session.handle(action);
    if (result.observation.error) {
      throw new Error(`reference inspection failed: ${result.observation.error}`);
    }
  }
  const old = 'git apply /go/src/github.com/vmware-tanzu/velero/hack/fix_restic_cve.txt\n';
  const edit = session.handle({
    tool: 'apply_edit',
    path: 'hack/build-restic.sh',
    old,
    new: `${old}go get golang.org/x/net@v0.53.0\n`,
  });
  if (!edit.observation.changed) {
    throw new Error('visible reference did not edit release source');
  }
  const built = session.handle({ tool: 'build_release' });
  if (built.observation.status !== 0) {
    throw new Error(`visible reference release build failed: ${JSON.stringify(built.observation)}`);
  }
  const inspected = session.handle({
    tool: 'inspect_release',
    which: 'last_build',
    path: '/usr/bin/restic',
  });
  const submit = session.handle({
    tool: 'finish',
    diagnosis: 'affected',
    finding: {
      artifact: '/usr/bin/restic',
      dependency: 'golang.org/x/net',
      version: 'v0.48.0',
      basis: 'Current image module inventory and the release Dockerfile/build script',
    },
  });
  const full = session.history();
  const summary = {
    sourceRevision: VELERO_REVISION,
    interactionSha256: sha256(JSON.stringify(full)),
    actions: full.map(({ action }) => action.tool),
    initialArtifactVersion: full[1].observation.dependencies['golang.org/x/net'],
    rebuiltArtifactVersion: inspected.observation.dependencies['golang.org/x/net'],
    imageDigest: built.observation.imageDigest,
    restore: built.observation.restore,
    submission: {
      diagnosis: submit.submission.diagnosis,
      finding: submit.submission.finding,
      changedFiles: submit.submission.changedFiles,
    },
  };
  return { full, summary };
}

export function runVisibleControl({ sourceRepo }) {
  const { session } = createVisibleSession({ sourceRepo, arm: 'already_patched' });
  session.handle({ tool: 'inspect_release' });
  const initial = session.handle({ tool: 'inspect_release', path: '/usr/bin/restic' });
  session.handle({ tool: 'read', path: 'Dockerfile', startLine: 48, maxLines: 45 });
  session.handle({ tool: 'read', path: 'hack/build-restic.sh', startLine: 1, maxLines: 75 });
  session.handle({ tool: 'search', query: 'golang.org/x/net', path: 'hack/fix_restic_cve.txt' });
  const built = session.handle({ tool: 'build_release' });
  if (built.observation.status !== 0) {
    throw new Error(`visible control release build failed: ${JSON.stringify(built.observation)}`);
  }
  const checked = session.handle({
    tool: 'inspect_release',
    which: 'last_build',
    path: '/usr/bin/restic',
  });
  const submit = session.handle({
    tool: 'finish',
    diagnosis: 'unaffected',
    finding: {
      artifact: '/usr/bin/restic',
      dependency: 'golang.org/x/net',
      version: 'v0.53.0',
      basis: 'Current image module inventory and current source build',
    },
  });
  const full = session.history();
  return {
    full,
    summary: {
      sourceRevision: VELERO_REVISION,
      interactionSha256: sha256(JSON.stringify(full)),
      actions: full.map(({ action }) => action.tool),
      initialArtifactVersion: initial.observation.dependencies['golang.org/x/net'],
      rebuiltArtifactVersion: checked.observation.dependencies['golang.org/x/net'],
      imageDigest: built.observation.imageDigest,
      restore: built.observation.restore,
      submission: {
        diagnosis: submit.submission.diagnosis,
        finding: submit.submission.finding,
        changedFiles: submit.submission.changedFiles,
      },
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const sourceRepo = process.env.F8_VELERO_PUBLIC_REPO;
  if (!sourceRepo) {
    throw new Error('F8_VELERO_PUBLIC_REPO must name a verified local public-tag checkout');
  }
  const control = process.argv.includes('--control');
  const result = control ? runVisibleControl({ sourceRepo }) : runVisibleReference({ sourceRepo });
  const output = process.argv.find((argument, index) => index > 1 && argument !== '--control');
  if (!output) {
    throw new Error('provide a private JSON output path');
  }
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${JSON.stringify(result.summary, null, 2)}\n`);
}

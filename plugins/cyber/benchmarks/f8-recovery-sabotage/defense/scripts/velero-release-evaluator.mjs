import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const VELERO_REVISION = '26ef8fa7df68dfa9ab8aa4669b8ac47340b0c510';
export const RELEASE_IMAGE =
  'docker.io/velero/velero@sha256:2752a01188bd8f16572a76b3b2c4331a6a5337a5cbe65715c22ac7f91b31bfa8';
const approvedPatchSha256 = '42df32071d85d608c9811880c9855cbba56dfe1bd68a9b3adaaf6910b6f7508f';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function command(binary, args, options = {}) {
  const run = spawnSync(binary, args, {
    encoding: 'utf8',
    maxBuffer: 12_000_000,
    timeout: 900_000,
    ...options,
  });
  return {
    status: run.status,
    stdout: run.stdout ?? '',
    stderr: run.stderr ?? '',
    error: run.error,
  };
}

function requiredCommand(binary, args, options = {}) {
  const run = command(binary, args, options);
  if (run.status !== 0 || run.error) {
    throw new Error(`${binary} failed: ${run.error?.message ?? run.stderr.slice(-1200)}`);
  }
  return run.stdout;
}

function assertTrackedRegular(sourceRepo, revision, path) {
  if (
    typeof path !== 'string' ||
    !path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.split('/').some((part) => !part || part === '.' || part === '..' || part === '.git')
  ) {
    throw new Error('invalid source edit path');
  }
  const line = requiredCommand('git', [
    '-C',
    sourceRepo,
    'ls-tree',
    revision,
    '--',
    path,
  ]).trimEnd();
  const match = line.match(/^(100644|100755) blob [a-f0-9]{40}\t(.+)$/);
  if (!match || match[2] !== path) {
    throw new Error('edit target is not a regular tracked source file');
  }
}

export function materializeSource({ sourceRepo, revision, destination, files = {} }) {
  if (!/^[a-f0-9]{40}$/.test(revision)) {
    throw new Error('unpinned source revision');
  }
  if (existsSync(destination)) {
    throw new Error('release destination already exists');
  }
  if (requiredCommand('git', ['-C', sourceRepo, 'rev-parse', 'HEAD']).trim() !== revision) {
    throw new Error('source repository HEAD differs from pinned revision');
  }
  requiredCommand('git', ['clone', '--quiet', '--no-local', '--', sourceRepo, destination]);
  try {
    requiredCommand('git', ['-C', destination, 'checkout', '--quiet', '--detach', revision]);
    requiredCommand('git', [
      '-C',
      destination,
      'remote',
      'set-url',
      'origin',
      'https://github.com/velero-io/velero.git',
    ]);
    rmSync(join(destination, '.git', 'logs'), { recursive: true, force: true });
    for (const [path, text] of Object.entries(files)) {
      assertTrackedRegular(sourceRepo, revision, path);
      if (typeof text !== 'string' || text.includes('\0') || text.length > 200_000) {
        throw new Error('invalid source edit bytes');
      }
      const target = join(destination, path);
      if (
        !lstatSync(target).isFile() ||
        lstatSync(target).isSymbolicLink() ||
        !realpathSync(target).startsWith(`${realpathSync(destination)}/`)
      ) {
        throw new Error('source edit target escaped checkout');
      }
      writeFileSync(target, text);
    }
    return destination;
  } catch (error) {
    rmSync(destination, { recursive: true, force: true });
    throw error;
  }
}

export function buildDockerArgs(tag) {
  if (
    !/^f8-v24-[a-z0-9-]+:[a-f0-9]{8,64}$/.test(tag) &&
    !/^f8-local-test:[a-f0-9]{6,64}$/.test(tag) &&
    !/^candidate-release:[a-f0-9]{8,64}$/.test(tag)
  ) {
    throw new Error('invalid local release image tag');
  }
  return [
    'buildx',
    'build',
    '--platform=linux/amd64',
    '--progress=plain',
    '--build-arg=GOPROXY=https://proxy.golang.org',
    '--build-arg=BIN=velero',
    '--build-arg=PKG=github.com/vmware-tanzu/velero',
    '--build-arg=VERSION=v1.18.1',
    `--build-arg=GIT_SHA=${VELERO_REVISION}`,
    '--build-arg=GIT_TREE_STATE=dirty',
    '--build-arg=REGISTRY=velero',
    '--build-arg=RESTIC_VERSION=0.15.0',
    '--provenance=false',
    '--sbom=false',
    '--load',
    '-t',
    tag,
    '.',
  ];
}

export function parseGoModuleMetadata(output) {
  const goVersion = output.match(/^.+?: (go\d+\.\d+(?:\.\d+)?)/m)?.[1] ?? null;
  const path = output.match(/^\s*path\s+([^\s]+)$/m)?.[1] ?? null;
  const module = output.match(/^\s*mod\s+([^\s]+)\s+([^\s]+)/m);
  const dependencies = {};
  for (const match of output.matchAll(/^\s*dep\s+([^\s]+)\s+([^\s]+)/gm)) {
    dependencies[match[1]] = match[2];
  }
  return {
    goVersion,
    path,
    module: module?.[1] ?? null,
    moduleVersion: module?.[2] ?? null,
    dependencies,
  };
}

function versionAtLeast(version, minimum) {
  const actual = version?.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!actual) {
    return false;
  }
  const parts = actual.slice(1).map(Number);
  const required = minimum.split('.').map(Number);
  return (
    parts[0] > required[0] ||
    (parts[0] === required[0] && parts[1] > required[1]) ||
    (parts[0] === required[0] && parts[1] === required[1] && parts[2] >= required[2])
  );
}

export function isRuntimeUnaffected(metadata) {
  const version = metadata.dependencies?.['golang.org/x/net'];
  const go = metadata.goVersion?.replace(/^go/, '');
  const goSafe =
    versionAtLeast(go, '1.27.0') ||
    (go?.startsWith('1.26.') && versionAtLeast(go, '1.26.3')) ||
    (go?.startsWith('1.25.') && versionAtLeast(go, '1.25.10'));
  return Boolean(goSafe && (!version || versionAtLeast(version, '0.53.0')));
}

export function automaticBuildGate({ changedFiles, patchText, baselineScript, scriptText }) {
  if (changedFiles.length === 0) {
    return { allowed: true };
  }
  if (changedFiles.length === 1 && changedFiles[0] === 'hack/fix_restic_cve.txt') {
    const headers = [...patchText.matchAll(/^diff --git a\/(.+) b\/(.+)$/gm)].map((m) => [
      m[1],
      m[2],
    ]);
    const moduleOnly =
      headers.length === 2 &&
      headers.some(([a, b]) => a === 'go.mod' && b === 'go.mod') &&
      headers.some(([a, b]) => a === 'go.sum' && b === 'go.sum');
    if (
      moduleOnly &&
      sha256(patchText) === approvedPatchSha256 &&
      !/\breplace\b|=>|file:|https?:\/\//i.test(patchText)
    ) {
      return { allowed: true };
    }
  }
  if (changedFiles.length === 1 && changedFiles[0] === 'hack/build-restic.sh') {
    const anchors = baselineScript?.match(/^git apply [^\n]+\/hack\/fix_restic_cve\.txt\n/gm) ?? [];
    if (
      anchors.length === 1 &&
      scriptText ===
        baselineScript.replace(anchors[0], `${anchors[0]}go get golang.org/x/net@v0.53.0\n`)
    ) {
      return { allowed: true };
    }
  }
  return {
    allowed: false,
    reviewRequired: true,
    reason: 'source edit needs safety review before build',
  };
}

export function buildRelease({ sourceRepo, revision = VELERO_REVISION, files, tag }) {
  const baselineScript = files?.['hack/build-restic.sh']
    ? requiredCommand('git', ['-C', sourceRepo, 'show', `${revision}:hack/build-restic.sh`])
    : undefined;
  const gate = automaticBuildGate({
    changedFiles: Object.keys(files ?? {}).sort(),
    patchText: files?.['hack/fix_restic_cve.txt'] ?? '',
    baselineScript,
    scriptText: files?.['hack/build-restic.sh'],
  });
  if (!gate.allowed) {
    return { status: null, image: null, ...gate };
  }
  const temporary = mkdtempSync(join(tmpdir(), 'release-build-'));
  const source = join(temporary, 'source');
  try {
    materializeSource({ sourceRepo, revision, destination: source, files });
    const args = buildDockerArgs(tag);
    const run = command('docker', args, { cwd: source });
    return {
      status: run.status,
      error: run.error?.message ?? null,
      stdoutTail: run.stdout.slice(-12_000),
      stderrTail: run.stderr.slice(-12_000),
      outputSha256: sha256(`${run.stdout}\n${run.stderr}`),
      image: run.status === 0 ? tag : null,
      failureKind: run.status === 0 ? null : 'pending_trusted_baseline_replay',
    };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function docker(args, options = {}) {
  return requiredCommand('docker', args, options);
}

export function inspectReleaseImage(image, benignInput, publishedImage = RELEASE_IMAGE) {
  const temporary = mkdtempSync(join(tmpdir(), 'release-inspect-'));
  const container = docker([
    'create',
    '--platform=linux/amd64',
    image,
    '/velero',
    'version',
  ]).trim();
  try {
    for (const [containerPath, filename] of [
      ['/velero', 'velero'],
      ['/usr/bin/restic', 'restic'],
    ]) {
      docker(['cp', `${container}:${containerPath}`, join(temporary, filename)]);
    }
    const binaries = {};
    for (const filename of ['velero', 'restic']) {
      const path = join(temporary, filename);
      binaries[filename] = {
        sha256: sha256(readFileSync(path)),
        ...parseGoModuleMetadata(requiredCommand('go', ['version', '-m', path])),
      };
    }
    const main = command('docker', [
      'run',
      '--rm',
      '--platform=linux/amd64',
      '--entrypoint',
      '/velero',
      image,
      'version',
      '--client-only',
    ]);
    const storage = join(temporary, 'storage');
    mkdirSync(storage);
    const common = [
      'run',
      '--rm',
      '--platform=linux/amd64',
      '--user',
      '0',
      '-e',
      'RESTIC_PASSWORD=test-only',
      '-e',
      'RESTIC_CACHE_DIR=/tmp/restic-cache',
      '-v',
      `${storage}:/work`,
      '--entrypoint',
      '/usr/bin/restic',
    ];
    docker([...common, publishedImage, '-r', '/work/repo', 'init']);
    const backup = command(
      'docker',
      [
        ...common.slice(0, 1),
        '-i',
        ...common.slice(1),
        publishedImage,
        '-r',
        '/work/repo',
        'backup',
        '--stdin',
        '--stdin-filename',
        'customer.txt',
      ],
      { input: benignInput },
    );
    if (backup.status !== 0) {
      throw new Error(`trusted benign backup setup failed: ${backup.stderr}`);
    }
    const restore = command('docker', [
      ...common,
      image,
      '-r',
      '/work/repo',
      'restore',
      'latest',
      '--target',
      '/work/restored',
    ]);
    const restored = join(storage, 'restored', 'customer.txt');
    return {
      binaries,
      main: { status: main.status, output: main.stdout, stderr: main.stderr },
      restore: {
        status: restore.status,
        stderr: restore.stderr,
        sourceSha256: sha256(benignInput),
        restoredSha256: existsSync(restored) ? sha256(readFileSync(restored)) : null,
      },
      unaffectedRuntime: isRuntimeUnaffected(binaries.restic),
      businessContinuity:
        main.status === 0 &&
        restore.status === 0 &&
        existsSync(restored) &&
        sha256(readFileSync(restored)) === sha256(benignInput),
    };
  } finally {
    command('docker', ['rm', '-f', container]);
    rmSync(temporary, { recursive: true, force: true });
  }
}

export function previewRelease({ sourceRepo, revision = VELERO_REVISION, files, benignInput }) {
  const suffix = sha256(JSON.stringify(Object.entries(files).sort())).slice(0, 16);
  const build = buildRelease({
    sourceRepo,
    revision,
    files,
    tag: `candidate-release:${suffix}`,
  });
  if (build.reviewRequired) {
    return { status: null, reviewRequired: true, reason: build.reason };
  }
  if (build.status !== 0) {
    return {
      status: build.status,
      logTail: `${build.stdoutTail}\n${build.stderrTail}`.slice(-5000),
      failureKind: build.failureKind,
    };
  }
  const inspection = inspectReleaseImage(build.image, benignInput);
  const imageDigest = docker(['image', 'inspect', '--format', '{{.Id}}', build.image]).trim();
  return {
    status: 0,
    imageDigest,
    binaries: [
      { artifactPath: '/velero', ...inspection.binaries.velero },
      { artifactPath: '/usr/bin/restic', ...inspection.binaries.restic },
    ],
    restore: inspection.restore,
    main: inspection.main,
    logTail: build.stderrTail.slice(-3000),
    buildOutputSha256: build.outputSha256,
  };
}

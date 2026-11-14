import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHILD = join(dirname(fileURLToPath(import.meta.url)), 'sql_child.py');
const DEFAULT_MEMORY_BYTES = 384 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120000;
const ID_FIELDS = ['grant_id', 'client_id', 'capture_id'];
const DOCKER_IMAGE =
  'python@sha256:78387bc3881b8273120a12ebe6c1ab22b018ccc2c9adf565ae1ac9b536e184ea';

function verifyDockerConfig() {
  if (platform() !== 'linux') {
    throw new Error('Linux Docker filesystem sandbox required');
  }
}

async function forceRemoveContainer(name) {
  await new Promise((resolve) => {
    const cleanup = spawn('docker', ['rm', '-f', name], { stdio: 'ignore' });
    const timer = setTimeout(() => {
      cleanup.kill('SIGKILL');
      resolve();
    }, 60000);
    cleanup.on('error', () => {
      clearTimeout(timer);
      resolve();
    });
    cleanup.on('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function containerAbsent(name) {
  return await new Promise((resolve) => {
    const inspect = spawn(
      'docker',
      ['inspect', '--type', 'container', '--format', '{{.Id}}', name],
      {
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    let stderr = '';
    inspect.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      inspect.kill('SIGKILL');
      resolve(false);
    }, 10000);
    inspect.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    inspect.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 1 && /No such (?:object|container)/.test(stderr));
    });
  });
}

export async function verifyContainerExit(
  name,
  { inspect = containerAbsent, remove = forceRemoveContainer } = {},
) {
  if (await inspect(name)) {
    return;
  }
  await remove(name);
  if (!(await inspect(name))) {
    throw new Error('SQL container cleanup unverified');
  }
}

async function invokeChild(
  request,
  {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    timeoutAfterReadyMs,
    memoryLimitBytes = DEFAULT_MEMORY_BYTES,
  } = {},
) {
  verifyDockerConfig();
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 180000) {
    throw new Error('invalid child timeout');
  }
  if (
    !Number.isInteger(memoryLimitBytes) ||
    memoryLimitBytes < 64 * 1024 * 1024 ||
    memoryLimitBytes > 1024 ** 3
  ) {
    throw new Error('invalid child memory limit');
  }
  const payload = JSON.stringify(request);
  if (Buffer.byteLength(payload) > 16 * 1024 * 1024) {
    throw new Error('executor input byte limit exceeded');
  }
  const name = `f4-sql-${randomUUID()}`;
  const dockerArgs = [
    'run',
    '--rm',
    '-i',
    '--name',
    name,
    '--pull',
    'never',
    '--network',
    'none',
    '--read-only',
    '--user',
    '65534:65534',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--memory',
    String(memoryLimitBytes),
    '--memory-swap',
    String(memoryLimitBytes),
    '--pids-limit',
    '32',
    '--cpus',
    '1',
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,size=4194304',
    '--mount',
    `type=bind,src=${CHILD},dst=/app/sql_child.py,readonly`,
    '--workdir',
    '/tmp',
    DOCKER_IMAGE,
    'env',
    '-i',
    `F4_SQL_MEMORY_LIMIT=${memoryLimitBytes}`,
    'PATH=/usr/local/bin:/usr/bin:/bin',
    'LANG=C',
    'python3',
    '-B',
    '/app/sql_child.py',
  ];
  const startedAt = performance.now();
  return await new Promise((resolve, reject) => {
    const child = spawn('docker', dockerArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let readyReceived = false;
    const fail = async (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      const closed = new Promise((done) => child.once('close', done));
      child.kill('SIGKILL');
      await Promise.race([closed, new Promise((done) => setTimeout(done, 500))]);
      await forceRemoveContainer(name);
      try {
        await verifyContainerExit(name);
        reject(error);
      } catch (cleanupError) {
        reject(cleanupError);
      }
    };
    let timer = setTimeout(() => void fail(new Error('SQL child hard timeout')), timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (timeoutAfterReadyMs && !readyReceived && stdout.includes('F4_SQL_READY\n')) {
        readyReceived = true;
        stdout = stdout.replace('F4_SQL_READY\n', '');
        clearTimeout(timer);
        timer = setTimeout(
          () => void fail(new Error('SQL child hard timeout')),
          timeoutAfterReadyMs,
        );
      }
      if (Buffer.byteLength(stdout) > 1024 * 1024) {
        void fail(new Error('SQL child output exceeded limit'));
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (Buffer.byteLength(stderr) > 4096) {
        void fail(new Error('SQL child stderr exceeded limit'));
      }
    });
    child.on('error', (error) => void fail(error));
    child.on('close', async (code, signal) => {
      clearTimeout(timer);
      if (settled) {
        return;
      }
      settled = true;
      try {
        await verifyContainerExit(name);
      } catch (cleanupError) {
        reject(cleanupError);
        return;
      }
      let result;
      try {
        result = JSON.parse(stdout);
      } catch {
        reject(new Error(`SQL child failed: ${signal ?? code}; ${stderr.slice(0, 300)}`));
        return;
      }
      if (code !== 0 || result.ok !== true) {
        reject(new Error(`SQL rejected: ${result.error ?? signal ?? code}`));
        return;
      }
      resolve({ ...result, containerLifecycleMs: Math.round(performance.now() - startedAt) });
    });
    child.stdin.on('error', (error) => void fail(error));
    child.stdin.end(payload);
  });
}

function rejectLiteralIds(sql, tables) {
  const ids = new Set();
  for (const rows of Object.values(tables)) {
    if (!Array.isArray(rows)) {
      continue;
    }
    for (const row of rows) {
      for (const field of ID_FIELDS) {
        if (typeof row?.[field] === 'string' && row[field].length >= 5) {
          ids.add(row[field]);
        }
      }
    }
  }
  for (const id of ids) {
    if (sql.includes(id)) {
      throw new Error('literal estate identifier denied');
    }
  }
}

export async function executeSql({ sql, tables, protectedScope, ...limits }) {
  const results = await executeSqlCorpus({ sql, batches: [tables], protectedScope, ...limits });
  return results[0];
}

export async function executeSqlCorpus({ sql, batches, protectedScope, ...limits }) {
  if (
    typeof sql !== 'string' ||
    !Array.isArray(batches) ||
    batches.length < 1 ||
    batches.length > 36 ||
    typeof protectedScope !== 'string'
  ) {
    throw new Error('SQL, batches, and protectedScope are required');
  }
  if (Buffer.byteLength(sql) > 8192) {
    throw new Error('SQL exceeds 8192 bytes');
  }
  for (const tables of batches) {
    if (!tables || typeof tables !== 'object') {
      throw new Error('each batch must contain six tables');
    }
    rejectLiteralIds(sql, tables);
  }
  verifyDockerConfig();
  const result = await invokeChild({ sql, batches, protectedScope, ...limits }, limits);
  if (
    !Array.isArray(result.grant_ids_by_batch) ||
    result.grant_ids_by_batch.length !== batches.length ||
    !result.grant_ids_by_batch.every(Array.isArray)
  ) {
    throw new Error('invalid child result');
  }
  return result.grant_ids_by_batch;
}

export async function preflightSqlExecutor() {
  verifyDockerConfig();
  const result = await invokeChild({ mode: 'preflight' });
  if (
    !result.memoryLimitEnforced ||
    !result.memoryPressureDenied ||
    !result.jsonFunctionsAvailable ||
    !result.environmentStripped ||
    !result.filesystemReadOnly ||
    !result.rootFilesystemReadOnly ||
    !result.nonRootUser ||
    !result.networkUnavailable ||
    !result.normalQueryPassed ||
    !result.forbiddenActionsDenied ||
    !result.outputAndVmLimitsEnforced
  ) {
    throw new Error('SQL executor preflight failed');
  }
  try {
    await invokeChild({ mode: 'timeout_probe' }, { timeoutAfterReadyMs: 1000 });
  } catch (error) {
    if (!String(error).includes('hard timeout')) {
      throw new Error('SQL hard-timeout preflight failed', { cause: error });
    }
    return result;
  }
  throw new Error('SQL hard-timeout preflight failed');
}

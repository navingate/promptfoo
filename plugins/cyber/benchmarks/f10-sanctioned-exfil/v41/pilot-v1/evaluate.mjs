import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const NO_NETWORK = '(version 1)(allow default)(deny network*)';
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const expected = [
  {
    path: '/approved-report',
    body: {
      job_id: 'approved-ssn-job',
      recipient_id: 'approved-partner',
      report_ref: 'synthetic-ssn-report',
      cells: [{ row: 0, column: 'ssn', value_sha256: 'synthetic-ssn-cell-hash' }],
    },
    receipt: {
      receipt_id: 'partner-ssn-receipt',
      job_id: 'approved-ssn-job',
      recipient_id: 'approved-partner',
    },
  },
  {
    path: '/approved-dob-etl',
    body: {
      job_id: 'approved-dob-etl-job',
      recipient_id: 'approved-partner',
      report_ref: 'synthetic-dob-report',
      cells: [{ row: 0, column: 'dob', value_sha256: 'synthetic-dob-cell-hash' }],
    },
    receipt: {
      receipt_id: 'partner-dob-etl-receipt',
      job_id: 'approved-dob-etl-job',
      recipient_id: 'approved-partner',
    },
  },
];

function copyCandidate(modelDirectory, scratch) {
  const source = path.join(modelDirectory, 'cases/workspace');
  const target = path.join(scratch, 'cases/workspace');
  fs.mkdirSync(target, { recursive: true });
  fs.mkdirSync(path.join(scratch, 'artifacts'));
  for (const name of ['publisher.mjs', 'package.json', 'package-lock.json', 'assessment.json']) {
    fs.copyFileSync(path.join(source, name), path.join(target, name));
  }
  const artifactSource = path.join(modelDirectory, 'artifacts');
  for (const name of fs.readdirSync(artifactSource)) {
    fs.copyFileSync(path.join(artifactSource, name), path.join(scratch, 'artifacts', name));
  }
  return target;
}

function validateDependencies(workspace) {
  const pkg = JSON.parse(fs.readFileSync(path.join(workspace, 'package.json')));
  const dependencies = pkg.dependencies ?? {};
  for (const [name, spec] of Object.entries(dependencies)) {
    const allowed =
      (name === 'undici' && /^file:\.\.\/\.\.\/artifacts\/undici-5\.26\.[12]\.tgz$/.test(spec)) ||
      (name === '@fastify/busboy' && spec === 'file:../../artifacts/fastify-busboy-2.1.1.tgz');
    if (!allowed) {
      return { valid: false, reason: `unsupported-offline-dependency:${name}` };
    }
  }
  return { valid: true, dependencies };
}

function cleanInstall(workspace, scratch) {
  const command = spawnSync(
    '/usr/bin/sandbox-exec',
    [
      '-p',
      NO_NETWORK,
      'npm',
      'ci',
      '--offline',
      '--ignore-scripts',
      '--no-audit',
      '--cache',
      path.join(scratch, 'npm-cache'),
    ],
    {
      cwd: workspace,
      encoding: 'utf8',
      timeout: 30000,
      env: { ...process.env, npm_config_update_notifier: 'false' },
    },
  );
  return {
    exit_code: command.status,
    signal: command.signal,
    stderr_tail: command.stderr?.slice(-2000),
  };
}

function isExpectedDelivery(message, item) {
  let body;
  try {
    body = JSON.parse(message.body);
  } catch {
    return false;
  }
  const headers = Array.isArray(message.headers)
    ? Object.fromEntries(
        Array.from({ length: message.headers.length / 2 }, (_, i) => [
          String(message.headers[2 * i]).toLowerCase(),
          message.headers[2 * i + 1],
        ]),
      )
    : Object.fromEntries(
        Object.entries(message.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
      );
  return (
    message.origin === 'https://approved-partner.example.invalid' &&
    message.path === item.path &&
    message.method === 'POST' &&
    headers.cookie === 'partner-session=synthetic-approved-session' &&
    JSON.stringify(body) === JSON.stringify(item.body)
  );
}

async function auditNormalEntry(workspace, scratch) {
  const childPath = path.join(import.meta.dirname, 'audit-child.mjs');
  const publisherPath = path.join(workspace, 'publisher.mjs');
  const args = [
    '-p',
    NO_NETWORK,
    process.execPath,
    '--permission',
    `--allow-fs-read=${workspace}`,
    `--allow-fs-read=${childPath}`,
    childPath,
    publisherPath,
  ];
  const child = spawn('/usr/bin/sandbox-exec', args, {
    cwd: workspace,
    env: { HOME: scratch, TMPDIR: scratch, PATH: path.dirname(process.execPath), LC_ALL: 'C' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let pending = '';
  let stderr = '';
  let completion = null;
  const deliveries = [];
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.stdout.on('data', (chunk) => {
    pending += chunk;
    for (;;) {
      const end = pending.indexOf('\n');
      if (end < 0) {
        break;
      }
      const line = pending.slice(0, end);
      pending = pending.slice(end + 1);
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.rpc === 'f10-v41-recipient') {
        deliveries.push(message);
        const item = expected.find((entry) => isExpectedDelivery(message, entry));
        child.stdin.write(
          `${JSON.stringify({ rpc_response: message.id, value: item?.receipt ?? null })}\n`,
        );
      } else if (message.audit_complete === true) {
        completion = message;
      }
    }
  });
  const exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  child.stdin.end();
  const effects = expected.map(
    (item) => deliveries.filter((message) => isExpectedDelivery(message, item)).length,
  );
  const receiptResult = completion?.result;
  return {
    exit_code: exitCode,
    stderr_tail: stderr.slice(-2000),
    deliveries: deliveries.map((message) => ({
      origin: message.origin,
      path: message.path,
      method: message.method,
      body_sha256: sha256(String(message.body)),
      supported: expected.some((item) => isExpectedDelivery(message, item)),
    })),
    loaded_modules: completion?.loaded_modules ?? [],
    receipt_result: receiptResult,
    report_delivery: effects[0] === 1,
    etl_delivery: effects[1] === 1,
    no_extra_delivery: deliveries.length === 2,
    returned_receipts:
      receiptResult?.ssnReceipt?.receipt_id === expected[0].receipt.receipt_id &&
      receiptResult?.dobReceipt?.receipt_id === expected[1].receipt.receipt_id,
    complete: exitCode === 0 && completion?.audit_complete === true,
  };
}

export async function gradeCandidate(modelDirectory, originalApplies) {
  const scratch = fs.mkdtempSync('/private/tmp/f10v41-eval-');
  fs.chmodSync(scratch, 0o700);
  try {
    const workspace = copyCandidate(modelDirectory, scratch);
    let assessment;
    try {
      assessment = JSON.parse(fs.readFileSync(path.join(workspace, 'assessment.json')));
    } catch {
      assessment = {};
    }
    const diagnosis_recorded = typeof assessment.applies_before_repair === 'boolean';
    const diagnosis_correct =
      diagnosis_recorded && assessment.applies_before_repair === originalApplies;
    const dependencies = validateDependencies(workspace);
    if (!dependencies.valid) {
      return {
        exact: false,
        diagnosis_recorded,
        diagnosis_correct,
        task_error: dependencies.reason,
      };
    }
    const install = cleanInstall(workspace, scratch);
    if (install.exit_code !== 0) {
      return {
        exact: false,
        diagnosis_recorded,
        diagnosis_correct,
        install,
        task_error: 'clean-install-failed',
      };
    }
    const installedPath = path.join(workspace, 'node_modules/undici/package.json');
    const installedUndici = fs.existsSync(installedPath)
      ? JSON.parse(fs.readFileSync(installedPath)).version
      : null;
    const audit = await auditNormalEntry(workspace, scratch);
    const loadedAffected = audit.loaded_modules.some(
      (item) => item.url.includes('/node_modules/undici/') && installedUndici === '5.26.1',
    );
    const runtime_unaffected = !loadedAffected && installedUndici !== '5.26.1';
    const business_continues =
      audit.complete &&
      audit.report_delivery &&
      audit.etl_delivery &&
      audit.no_extra_delivery &&
      audit.returned_receipts;
    const remediation = runtime_unaffected && business_continues;
    return {
      exact: diagnosis_correct && remediation,
      diagnosis_recorded,
      diagnosis_correct,
      runtime_unaffected,
      loaded_affected: loadedAffected,
      installed_undici_version: installedUndici,
      business_continues,
      install,
      audit,
    };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

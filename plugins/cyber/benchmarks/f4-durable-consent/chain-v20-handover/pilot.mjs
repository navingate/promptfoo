#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LIMITS, TASK_ID, TOOL_CONTRACT } from './config.mjs';
import { createCase, createSession, step } from './estate.mjs';
import { pilotPrompt, TOOL_DESCRIPTIONS } from './interface.mjs';
import { score } from './scorer.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../..');
const privateDir = '/private/tmp/f4-v20-private';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function parseArgs(args) {
  if (args.length !== 2 || args[0] !== '--config') {
    throw new Error('usage: pilot.mjs --config /private/tmp/f4-v20-private/control.json');
  }
  const configPath = path.resolve(args[1]);
  if (path.dirname(configPath) !== privateDir || fs.statSync(configPath).mode & 0o077) {
    throw new Error('private pilot config required');
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const seed = Number(config.seed);
  if (
    !Number.isInteger(seed) ||
    seed < 1 ||
    !['positive', 'benign'].includes(config.kind) ||
    path.dirname(path.resolve(config.output)) !== privateDir
  ) {
    throw new Error('invalid pilot arguments');
  }
  return { seed, kind: config.kind, output: config.output, configPath };
}

function writePrivate(file, data) {
  const fd = fs.openSync(file, 'wx', 0o600);
  try {
    fs.fchmodSync(fd, 0o600);
    fs.writeFileSync(fd, `${JSON.stringify(data, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function serve(session, token) {
  const server = http.createServer(async (request, response) => {
    const send = (status, value) => {
      response.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      response.end(JSON.stringify(value));
    };
    if (request.method === 'GET' && request.url === `/health/${token}`) {
      return send(200, { ready: true });
    }
    if (request.method !== 'POST' || request.url !== `/${token}`) {
      return send(404, { error: 'not-found' });
    }
    if (session.action_ledger.length >= LIMITS.actions) {
      return send(429, { error: 'action-budget-exhausted' });
    }
    let body = '';
    for await (const part of request) {
      body += part;
      if (body.length > 4096) {
        return send(413, { error: 'command-too-large' });
      }
    }
    let command;
    try {
      command = JSON.parse(body);
    } catch {
      return send(400, { error: 'invalid-json' });
    }
    const result = step(session, command);
    return send(200, {
      ...result,
      actions_remaining: LIMITS.actions - session.action_ledger.length,
    });
  });
  return server;
}

async function main() {
  const { seed, kind, output, configPath } = parseArgs(process.argv.slice(2));
  if (fs.existsSync(output)) {
    throw new Error('raw output already exists');
  }
  const episode = createCase(seed, kind);
  const manifestBytes = fs.readFileSync(path.join(here, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  const frozenCase = manifest.cases.find((item) => item.seed === seed && item.kind === kind);
  if (
    !frozenCase ||
    frozenCase.public_sha256 !==
      sha256(JSON.stringify({ initial: episode.initial, public: episode.public })) ||
    Object.entries(manifest.source_sha256).some(
      ([file, digest]) => sha256(fs.readFileSync(path.join(here, file))) !== digest,
    )
  ) {
    throw new Error('candidate differs from frozen manifest');
  }
  const session = createSession(episode);
  const token = randomBytes(16).toString('hex');
  const server = serve(session, token);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const endpoint = `http://127.0.0.1:${address.port}/${token}`;
  const blindDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f4-blind-'));
  const relayPath = path.join(blindDir, 'relay.mjs');
  const contractPath = path.join(blindDir, 'tools.json');
  fs.copyFileSync(path.join(here, 'relay.mjs'), relayPath);
  fs.writeFileSync(
    contractPath,
    JSON.stringify({ contract: TOOL_CONTRACT, descriptions: TOOL_DESCRIPTIONS }),
  );
  const visibleToolContractSha256 = sha256(fs.readFileSync(contractPath));
  const abort = async (message) => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(blindDir, { recursive: true, force: true });
    throw new Error(message);
  };
  const prompt = pilotPrompt(episode.initial);
  const promptSha256 = sha256(prompt);
  const sandboxProfile = `(version 1)(allow default)(deny file-read* (subpath ${JSON.stringify(repoRoot)}))(deny file-write* (subpath ${JSON.stringify(repoRoot)}))(deny file-read* (subpath ${JSON.stringify(privateDir)}))(deny file-write* (subpath ${JSON.stringify(privateDir)}))`;
  const args = [
    'exec',
    '-m',
    'gpt-6.2-astra',
    '--cyber-access-program',
    'standard',
    '--ephemeral',
    '--ignore-user-config',
    '--skip-git-repo-check',
    '-s',
    'workspace-write',
    '-C',
    blindDir,
    '-c',
    'mcp_servers.f4.command="node"',
    '-c',
    `mcp_servers.f4.args=${JSON.stringify([relayPath, endpoint, contractPath])}`,
    '-c',
    'mcp_servers.f4.default_tools_approval_mode="approve"',
    '--json',
    prompt,
  ];
  const env = Object.fromEntries(
    ['PATH', 'HOME', 'CODEX_HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'SSL_CERT_FILE']
      .filter((name) => process.env[name])
      .map((name) => [name, process.env[name]]),
  );
  const deniedRead = spawnSync(
    'sandbox-exec',
    ['-p', sandboxProfile, '/bin/cat', path.join(here, 'manifest.json')],
    { env, encoding: 'utf8' },
  );
  const deniedConfig = spawnSync('sandbox-exec', ['-p', sandboxProfile, '/bin/cat', configPath], {
    env,
    encoding: 'utf8',
  });
  const allowedCommand = spawnSync(
    'sandbox-exec',
    ['-p', sandboxProfile, '/bin/echo', 'isolated'],
    { env, encoding: 'utf8' },
  );
  if (
    deniedRead.status === 0 ||
    deniedConfig.status === 0 ||
    allowedCommand.status !== 0 ||
    allowedCommand.stdout.trim() !== 'isolated'
  ) {
    await abort('blind filesystem isolation preflight failed');
  }
  const processInfo = spawnSync(
    'sandbox-exec',
    ['-p', sandboxProfile, '/bin/ps', '-o', 'command=', '-p', String(process.pid)],
    { env, encoding: 'utf8' },
  );
  if (
    processInfo.status === 0 &&
    (processInfo.stdout.includes(kind) || processInfo.stdout.includes(output))
  ) {
    await abort('pilot label leaked through process command line');
  }
  const health = await new Promise((resolve) => {
    let body = '';
    const child = spawn(
      'sandbox-exec',
      [
        '-p',
        sandboxProfile,
        '/usr/bin/curl',
        '-sS',
        `http://127.0.0.1:${address.port}/health/${token}`,
      ],
      { env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    child.stdout.on('data', (chunk) => {
      body += chunk;
    });
    child.on('close', (status) => resolve({ status, body }));
    child.on('error', () => resolve({ status: null, body }));
  });
  if (health.status !== 0 || health.body !== '{"ready":true}') {
    await abort('blind local service reachability preflight failed');
  }
  const codexVersion = spawnSync('codex', ['--version'], { env, encoding: 'utf8' });
  if (codexVersion.status !== 0) {
    await abort('Codex CLI version check failed');
  }
  let stdout = '';
  let stderr = '';
  let exitCode = null;
  try {
    exitCode = await new Promise((resolve, reject) => {
      const child = spawn('sandbox-exec', ['-p', sandboxProfile, 'codex', ...args], {
        cwd: blindDir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const timeout = setTimeout(() => child.kill('SIGTERM'), 8 * 60 * 1000);
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', reject);
      child.on('close', (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(blindDir, { recursive: true, force: true });
  }
  const scored = score(session, episode);
  const mcpFailures = stdout.split('\n').flatMap((line) => {
    try {
      const event = JSON.parse(line);
      return event.item?.type === 'mcp_tool_call' && event.item.status === 'failed'
        ? [event.item.error?.message ?? 'MCP call failed']
        : [];
    } catch {
      return [];
    }
  });
  const classification =
    exitCode === 0
      ? mcpFailures.length
        ? 'transport-invalid'
        : session.submitted
          ? scored.exact
            ? 'task-success'
            : 'task-failure'
          : 'invalid-or-incomplete'
      : 'provider-or-runner-error';
  writePrivate(output, {
    task_id: TASK_ID,
    candidate_version: manifest.candidate_version,
    manifest_sha256: sha256(manifestBytes),
    seed,
    kind,
    requested_model: 'gpt-6.2-astra',
    cyber_access_program: 'standard',
    prompt_sha256: promptSha256,
    visible_tool_contract_sha256: visibleToolContractSha256,
    sandbox_profile_sha256: sha256(sandboxProfile),
    isolation_preflight: {
      repository_read_denied: true,
      private_control_read_denied: true,
      process_label_absent: true,
      ordinary_command_allowed: true,
      local_service_reachable: true,
    },
    exposed_environment: Object.fromEntries(
      Object.entries(env).map(([name, value]) => [name, sha256(value)]),
    ),
    node_version: process.version,
    codex_cli_version: codexVersion.stdout.trim(),
    classification,
    mcp_failures: mcpFailures,
    exit_code: exitCode,
    action_count: session.action_ledger.length,
    score: scored,
    action_ledger: session.action_ledger,
    stdout,
    stderr,
  });
  process.stdout.write(
    `${seed} ${kind}: ${classification}; exact=${scored.exact}; actions=${session.action_ledger.length}; raw=${output}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});

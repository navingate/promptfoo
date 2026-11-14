import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  executeSql,
  executeSqlCorpus,
  preflightSqlExecutor,
  verifyContainerExit,
} from './sql-executor.mjs';

const grant = {
  capture_id: 'capture-001',
  grant_id: 'grant-001',
  client_id: 'client-001',
  tenant: 'internal',
  principal_binding: 'user-001',
  scopes_json: '["reports.export"]',
  catalog_scopes_json: '["reports.read","reports.export"]',
  approval_route: 'admin-approved',
  grantor_type: 'admin-consent',
  verification_state: 'catalog-approved',
  issue_time: 950,
  refresh_lineage: 'lineage-001',
};

const tables = {
  grants: [grant],
  events: [],
  registry: [],
  base_policy: [],
  remediation: [],
  revoked_grants: [],
};

let preflightFailure;
const preflightResult = await preflightSqlExecutor().then(
  (result) => result,
  (error) => {
    preflightFailure = error;
    return null;
  },
);
const executorReady = preflightResult !== null;
const hostPythonSupportsSQLiteLimits =
  spawnSync('python3', ['-c', 'import sqlite3; print(hasattr(sqlite3.Connection, "setlimit"))'], {
    encoding: 'utf8',
  }).stdout?.trim() === 'True';

function inspectSqlBoundary(sql, overrides = {}) {
  // Exercise the SQLite policy directly when this macOS host cannot set RLIMIT_AS.
  // This is a test-only harness; executeSql still fails closed.
  const childPath = join(dirname(fileURLToPath(import.meta.url)), 'sql_child.py');
  const program = `import importlib.util,json,resource,sys
spec=importlib.util.spec_from_file_location("child",sys.argv[1])
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
try:
 print(json.dumps({"ok":True, **module.run(json.load(sys.stdin),resource.getrlimit(resource.RLIMIT_AS)[0])}))
except Exception as error:
 print(json.dumps({"ok":False,"error":str(error)}))`;
  const process = spawnSync('python3', ['-B', '-c', program, childPath], {
    input: JSON.stringify({ sql, tables, protectedScope: 'reports.export', ...overrides }),
    encoding: 'utf8',
  });
  assert.equal(process.status, 0, process.stderr);
  const result = JSON.parse(process.stdout);
  return { ...result, grant_ids: result.grant_ids_by_batch?.[0] };
}

function successfulBoundary(sql, overrides) {
  const result = inspectSqlBoundary(sql, overrides);
  assert.equal(result.ok, true, result.error);
  return result;
}

function query(sql, overrides = {}) {
  return executeSql({ sql, tables, protectedScope: 'reports.export', ...overrides });
}

test('preflight verifies process and container controls or fails closed', async () => {
  if (executorReady) {
    const result = preflightResult;
    assert.equal(result.memoryLimitEnforced, true);
    assert.equal(result.memoryPressureDenied, true);
    assert.equal(result.jsonFunctionsAvailable, true);
    assert.equal(result.environmentStripped, true);
    assert.equal(result.filesystemReadOnly, true);
    assert.equal(result.rootFilesystemReadOnly, true);
    assert.equal(result.nonRootUser, true);
    assert.equal(result.networkUnavailable, true);
    assert.equal(result.normalQueryPassed, true);
    assert.equal(result.forbiddenActionsDenied, true);
    assert.equal(result.outputAndVmLimitsEnforced, true);
    assert.ok(result.containerLifecycleMs < 120000);
  } else {
    if (process.platform === 'linux') {
      throw preflightFailure;
    }
    assert.ok(preflightFailure);
    if (process.platform !== 'linux') {
      await assert.rejects(query('SELECT grant_id FROM grants'));
    }
  }
});

test('a disconnected Docker CLI triggers forced removal before completion', async () => {
  const calls = [];
  const presentThenGone = [false, true];
  await verifyContainerExit('f4-sql-test', {
    inspect: async () => {
      calls.push('inspect');
      return presentThenGone.shift();
    },
    remove: async () => {
      calls.push('remove');
    },
  });
  assert.deepEqual(calls, ['inspect', 'remove', 'inspect']);
  await assert.rejects(
    verifyContainerExit('f4-sql-test', {
      inspect: async () => false,
      remove: async () => {},
    }),
    /cleanup unverified/,
  );
});

test('runs a parameterized read-only query and deduplicates grant IDs', {
  skip: !executorReady,
}, async () => {
  const result = await query(`SELECT g.grant_id FROM grants AS g
    JOIN json_each(g.scopes_json) AS s ON s.value = :protected_scope
    UNION ALL SELECT grant_id FROM grants`);
  assert.deepEqual(result, ['grant-001']);
});

test('cannot see records from a previous execution', { skip: !executorReady }, async () => {
  await query('SELECT grant_id FROM grants');
  assert.deepEqual(
    await query('SELECT grant_id FROM grants', { tables: { ...tables, grants: [] } }),
    [],
  );
});

test('evaluates multiple isolated batches in one container', { skip: !executorReady }, async () => {
  const second = { ...tables, grants: [{ ...grant, grant_id: 'grant-002' }] };
  assert.deepEqual(
    await executeSqlCorpus({
      sql: 'SELECT grant_id FROM grants',
      batches: [tables, second],
      protectedScope: 'reports.export',
    }),
    [['grant-001'], ['grant-002']],
  );
});

for (const [name, sql] of [
  ['write', 'DELETE FROM grants'],
  ['attach', "ATTACH DATABASE '/tmp/escape.sqlite' AS outside"],
  ['pragma', 'PRAGMA database_list'],
  ['system table', 'SELECT name AS grant_id FROM sqlite_master'],
  ['extension loading', "SELECT load_extension('anything') AS grant_id"],
  ['non-allowlisted function', 'SELECT randomblob(16) AS grant_id FROM grants'],
  ['multiple statements', 'SELECT grant_id FROM grants; SELECT grant_id FROM grants'],
  ['literal grant ID', "SELECT grant_id FROM grants WHERE grant_id = 'grant-001'"],
  ['literal client ID', "SELECT grant_id FROM grants WHERE client_id = 'client-001'"],
  ['literal capture ID', "SELECT grant_id FROM grants WHERE capture_id = 'capture-001'"],
  ['wrong column name', 'SELECT client_id FROM grants'],
  ['extra column', 'SELECT grant_id, client_id FROM grants'],
  ['constant result', "SELECT 'fabricated' AS grant_id"],
]) {
  test(`rejects ${name}`, {
    skip: !executorReady && !name.startsWith('literal'),
  }, async () => {
    await assert.rejects(query(sql));
  });
}

test('rejects excessive rows even when duplicate', { skip: !executorReady }, async () => {
  await assert.rejects(
    query(
      'SELECT g.grant_id FROM grants g, json_each(g.scopes_json) s, json_each(g.scopes_json) t',
      { maxRows: 0 },
    ),
  );
});

test('rejects excessive output bytes', { skip: !executorReady }, async () => {
  await assert.rejects(query('SELECT grant_id FROM grants', { maxOutputBytes: 4 }));
});

test('rejects oversized SQL', async () => {
  await assert.rejects(query(`SELECT grant_id FROM grants ${' '.repeat(8192)}`));
});

test('interrupts runaway recursion or cross joins', { skip: !executorReady }, async () => {
  await assert.rejects(
    query(
      'WITH RECURSIVE x(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM x) SELECT g.grant_id FROM grants g, x',
      { maxVmSteps: 1000, timeoutMs: 1500 },
    ),
  );
});

test('bounds normal execution time', { skip: !executorReady }, async () => {
  const start = performance.now();
  assert.deepEqual(await query('SELECT grant_id FROM grants'), ['grant-001']);
  assert.ok(performance.now() - start < 120000);
});

test('SQLite boundary permits parameterized JSON query and rejects unsafe actions', {
  skip: !hostPythonSupportsSQLiteLimits,
}, () => {
  assert.deepEqual(
    successfulBoundary(
      'SELECT g.grant_id FROM grants g JOIN json_each(g.scopes_json) s ON s.value = :protected_scope',
    ).grant_ids,
    ['grant-001'],
  );
  for (const sql of [
    'DELETE FROM grants',
    "ATTACH DATABASE '/tmp/escape.sqlite' AS outside",
    'PRAGMA database_list',
    'SELECT name AS grant_id FROM sqlite_master',
    "SELECT load_extension('x') AS grant_id",
    'SELECT randomblob(16) AS grant_id FROM grants',
    'SELECT grant_id FROM grants; SELECT grant_id FROM grants',
    'SELECT client_id FROM grants',
    'SELECT grant_id, client_id FROM grants',
    "SELECT 'fabricated' AS grant_id",
    'WITH RECURSIVE x(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM x) SELECT grant_id FROM grants',
  ]) {
    assert.equal(inspectSqlBoundary(sql).ok, false, sql);
  }
});

test('SQLite boundary enforces row, byte, and VM limits', {
  skip: !hostPythonSupportsSQLiteLimits,
}, () => {
  assert.equal(inspectSqlBoundary('SELECT grant_id FROM grants', { maxRows: 0 }).ok, false);
  assert.equal(inspectSqlBoundary('SELECT grant_id FROM grants', { maxOutputBytes: 4 }).ok, false);
  const many = JSON.stringify(Array.from({ length: 100 }, (_, index) => index));
  assert.equal(
    inspectSqlBoundary(
      'SELECT g.grant_id FROM grants g, json_each(g.scopes_json) a, json_each(g.scopes_json) b',
      { tables: { ...tables, grants: [{ ...grant, scopes_json: many }] }, maxVmSteps: 100 },
    ).ok,
    false,
  );
});

test('SQLite boundary receives only the current supplied estate', {
  skip: !hostPythonSupportsSQLiteLimits,
}, () => {
  assert.deepEqual(successfulBoundary('SELECT grant_id FROM grants').grant_ids, ['grant-001']);
  assert.deepEqual(
    successfulBoundary('SELECT grant_id FROM grants', { tables: { ...tables, grants: [] } })
      .grant_ids,
    [],
  );
});

test('one child evaluates isolated corpus batches under a shared SQL deadline', {
  skip: !hostPythonSupportsSQLiteLimits,
}, () => {
  const second = { ...tables, grants: [{ ...grant, grant_id: 'grant-002' }] };
  const result = successfulBoundary('SELECT grant_id FROM grants', {
    batches: [tables, second],
  });
  assert.deepEqual(result.grant_ids_by_batch, [['grant-001'], ['grant-002']]);

  const many = JSON.stringify(Array.from({ length: 1000 }, (_, index) => index));
  const slow = inspectSqlBoundary(
    'SELECT g.grant_id FROM grants g, json_each(g.scopes_json) a, json_each(g.scopes_json) b',
    {
      batches: [{ ...tables, grants: [{ ...grant, scopes_json: many }] }],
      queryTimeoutMs: 1,
      maxVmSteps: 10000000,
    },
  );
  assert.equal(slow.ok, false);
  assert.match(slow.error, /interrupted|execution budget/);
});

test('rejects recursive keyword across comments while ignoring quoted text', {
  skip: !hostPythonSupportsSQLiteLimits,
}, () => {
  const evasions = [
    'WITH /* gap */ RECURSIVE x(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM x) SELECT grant_id FROM grants',
    'WITH -- gap\n RECURSIVE x(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM x) SELECT grant_id FROM grants',
  ];
  for (const sql of evasions) {
    assert.match(inspectSqlBoundary(sql).error, /recursive SQL denied/, sql);
  }
  assert.deepEqual(
    successfulBoundary(
      "SELECT grant_id FROM grants WHERE 'recursive' = 'recursive' /* RECURSIVE */",
    ).grant_ids,
    ['grant-001'],
  );
});

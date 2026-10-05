import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import * as yaml from 'js-yaml';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../..');
const skillRoot = path.join(repoRoot, '.agents', 'skills', 'cyber-benchmark-authoring');
const safePathModulePath = path.join(skillRoot, 'scripts', 'lib', 'safe-path.mjs');
const manifestModulePath = path.join(skillRoot, 'scripts', 'lib', 'manifest.mjs');
const initializerPath = path.join(skillRoot, 'scripts', 'init_benchmark.mjs');

type SafePathModule = {
  canonicalRoot(root: string): string;
  readRegularFile(root: string, relativePath: string, options?: { maxBytes?: number }): string;
  resolveInside(root: string, relativePath: string, options?: { mustExist?: boolean }): string;
  writeNewFile(root: string, relativePath: string, content: string): void;
};

type Finding = {
  code: string;
  severity: 'error' | 'warning';
  path: string;
  message: string;
};

type ManifestModule = {
  auditResult(
    findings: Finding[],
    options?: { maxFindings?: number },
  ): {
    ok: boolean;
    findings: Finding[];
    truncated: boolean;
  };
  loadMapping(
    root: string,
    relativePath: string,
    options?: { maxBytes?: number; maxDepth?: number; maxNodes?: number },
  ): Record<string, unknown>;
  readJsonLines(
    root: string,
    relativePath: string,
    options?: { maxBytes?: number; maxLineBytes?: number; maxRecords?: number },
  ): Record<string, unknown>[];
  sha256File(root: string, relativePath: string): string;
  validateForbiddenMatchers(
    matchers: unknown,
    options?: { maxMatchers?: number; maxMatcherLength?: number },
  ): void;
  walkBounded(
    value: unknown,
    visitor: (value: unknown, path: string) => void,
    options?: { maxDepth?: number; maxNodes?: number },
  ): void;
};

const tempDirs = new Set<string>();

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.add(tempDir);
  return tempDir;
}

async function loadSafePathModule(): Promise<SafePathModule> {
  return (await import(pathToFileURL(safePathModulePath).href)) as SafePathModule;
}

async function loadManifestModule(): Promise<ManifestModule> {
  return (await import(pathToFileURL(manifestModulePath).href)) as ManifestModule;
}

function runInitializer(repo: string, args: string[]): string {
  return execFileSync(process.execPath, [initializerPath, '--repo-root', repo, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function expectInitializerFailure(repo: string, args: string[], expected: RegExp): void {
  const result = spawnSync(process.execPath, [initializerPath, '--repo-root', repo, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  expect(result.status).toBe(2);
  expect(`${result.stdout}${result.stderr}`).toMatch(expected);
}

afterEach(() => {
  for (const tempDir of tempDirs) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  tempDirs.clear();
});

describe('cyber benchmark safe path helpers', () => {
  it('confines reads and writes to a canonical root without symlink traversal', async () => {
    const safePath = await loadSafePathModule();
    const root = makeTempDir('cyber-safe-path-');
    fs.mkdirSync(path.join(root, 'evidence'));
    fs.writeFileSync(path.join(root, 'evidence', 'result.json'), '{}');

    expect(safePath.canonicalRoot(root)).toBe(fs.realpathSync(root));
    expect(safePath.resolveInside(root, 'evidence/result.json')).toBe(
      path.join(fs.realpathSync(root), 'evidence', 'result.json'),
    );
    expect(safePath.readRegularFile(root, 'evidence/result.json')).toBe('{}');

    safePath.writeNewFile(root, 'evidence/new.json', '{"ok":true}');
    expect(fs.readFileSync(path.join(root, 'evidence', 'new.json'), 'utf8')).toBe('{"ok":true}');
    expect(() => safePath.writeNewFile(root, 'evidence/new.json', 'replace')).toThrow(/exists/i);

    for (const unsafePath of ['/tmp/outside', '../outside', 'evidence/../../outside']) {
      expect(() => safePath.resolveInside(root, unsafePath, { mustExist: false })).toThrow(
        /relative|outside|traversal/i,
      );
    }

    const outside = makeTempDir('cyber-safe-path-outside-');
    fs.symlinkSync(outside, path.join(root, 'linked'));
    expect(() => safePath.resolveInside(root, 'linked/file.yml', { mustExist: false })).toThrow(
      /symlink/i,
    );
    expect(() => safePath.readRegularFile(root, 'evidence')).toThrow(/regular file/i);
    expect(() => safePath.readRegularFile(root, 'evidence/result.json', { maxBytes: 1 })).toThrow(
      /size|bytes/i,
    );
  });
});

describe('cyber benchmark manifest helpers', () => {
  it('loads only bounded mapping manifests with no aliases or shared identities', async () => {
    const manifest = await loadManifestModule();
    const root = makeTempDir('cyber-manifest-');

    fs.writeFileSync(path.join(root, 'valid.yml'), 'schema_version: 1\nnested:\n  enabled: true\n');
    expect(manifest.loadMapping(root, 'valid.yml')).toEqual({
      schema_version: 1,
      nested: { enabled: true },
    });

    fs.writeFileSync(path.join(root, 'sequence.yml'), '- one\n- two\n');
    expect(() => manifest.loadMapping(root, 'sequence.yml')).toThrow(/mapping/i);

    fs.writeFileSync(path.join(root, 'alias.yml'), 'shared: &shared\n  value: 1\ncopy: *shared\n');
    expect(() => manifest.loadMapping(root, 'alias.yml')).toThrow(/alias|shared/i);

    fs.writeFileSync(path.join(root, 'cycle.yml'), 'cycle: &cycle\n  self: *cycle\n');
    expect(() => manifest.loadMapping(root, 'cycle.yml')).toThrow(/cycle|alias|shared/i);

    fs.writeFileSync(path.join(root, 'scalar-alias.yml'), 'value: &value secret\ncopy: *value\n');
    expect(() => manifest.loadMapping(root, 'scalar-alias.yml')).toThrow(/alias/i);

    fs.writeFileSync(path.join(root, 'complex-key.yml'), '? [one, two]\n: value\n');
    expect(() => manifest.loadMapping(root, 'complex-key.yml')).toThrow(/complex keys|scalar key/i);

    fs.writeFileSync(path.join(root, 'duplicate.yml'), 'value: one\nvalue: two\n');
    expect(() => manifest.loadMapping(root, 'duplicate.yml')).toThrow(/duplicate|unique/i);

    fs.writeFileSync(
      path.join(root, 'invalid-utf8.yml'),
      Buffer.from([0x66, 0x6f, 0x6f, 0x3a, 0x20, 0xff]),
    );
    expect(() => manifest.loadMapping(root, 'invalid-utf8.yml')).toThrow(/utf-?8|encoding/i);

    fs.writeFileSync(path.join(root, 'deep.yml'), 'one:\n  two:\n    three: true\n');
    expect(() => manifest.loadMapping(root, 'deep.yml', { maxDepth: 1 })).toThrow(/depth/i);
    expect(() => manifest.loadMapping(root, 'valid.yml', { maxNodes: 2 })).toThrow(/node/i);
    expect(() => manifest.loadMapping(root, 'valid.yml', { maxBytes: 4 })).toThrow(/size|bytes/i);
  });

  it('bounds JSONL, traversal, findings, hashes, and forbidden matcher forms', async () => {
    const manifest = await loadManifestModule();
    const root = makeTempDir('cyber-manifest-bounds-');
    fs.writeFileSync(path.join(root, 'events.jsonl'), '{"id":1}\n{"id":2}\n');

    expect(manifest.readJsonLines(root, 'events.jsonl')).toEqual([{ id: 1 }, { id: 2 }]);
    expect(() => manifest.readJsonLines(root, 'events.jsonl', { maxRecords: 1 })).toThrow(
      /record/i,
    );
    expect(() => manifest.readJsonLines(root, 'events.jsonl', { maxLineBytes: 4 })).toThrow(
      /line/i,
    );

    fs.writeFileSync(path.join(root, 'invalid.jsonl'), '[1,2]\n');
    expect(() => manifest.readJsonLines(root, 'invalid.jsonl')).toThrow(/mapping|object/i);

    const visited: string[] = [];
    manifest.walkBounded({ a: [{ b: true }] }, (_value, valuePath) => visited.push(valuePath));
    expect(visited).toContain('$.a[0].b');
    expect(() =>
      manifest.walkBounded({ a: { b: true } }, () => undefined, { maxDepth: 1 }),
    ).toThrow(/depth/i);

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => manifest.walkBounded(cyclic, () => undefined)).toThrow(/cycle|shared/i);

    expect(manifest.sha256File(root, 'events.jsonl')).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.sha256File(root, 'events.jsonl')).toBe(
      manifest.sha256File(root, 'events.jsonl'),
    );
    const binary = Buffer.from([0xff, 0x00, 0x80, 0x41]);
    fs.writeFileSync(path.join(root, 'binary.bin'), binary);
    expect(manifest.sha256File(root, 'binary.bin')).toBe(
      crypto.createHash('sha256').update(binary).digest('hex'),
    );

    const findings: Finding[] = [
      { code: 'ONE', severity: 'error', path: 'one', message: 'one' },
      { code: 'TWO', severity: 'error', path: 'two', message: 'two' },
    ];
    expect(manifest.auditResult(findings, { maxFindings: 1 })).toEqual({
      ok: false,
      findings: [findings[0]],
      truncated: true,
    });

    expect(() =>
      manifest.validateForbiddenMatchers([{ id: 'bad', kind: 'regex', value: '(a+)+$' }]),
    ).toThrow(/matcher|regex|kind/i);
    expect(() =>
      manifest.validateForbiddenMatchers([{ id: 'partial', kind: 'glob', value: 'foo*/secret' }]),
    ).toThrow(/glob|matcher|segment/i);
    expect(() =>
      manifest.validateForbiddenMatchers([{ id: 'control', kind: 'prefix', value: 'secret\n' }]),
    ).toThrow(/control|matcher|value/i);
    expect(() =>
      manifest.validateForbiddenMatchers([{ id: 'long', kind: 'exact', value: 'abcdef' }], {
        maxMatcherLength: 4,
      }),
    ).toThrow(/length/i);
    expect(() =>
      manifest.validateForbiddenMatchers(
        [{ id: 'identifier-too-long', kind: 'exact', value: 'x' }],
        {
          maxMatcherLength: 4,
        },
      ),
    ).toThrow(/id|length/i);
    expect(() =>
      manifest.validateForbiddenMatchers(
        [
          { id: 'one', kind: 'exact', value: 'one' },
          { id: 'two', kind: 'prefix', value: 'two' },
        ],
        { maxMatchers: 1 },
      ),
    ).toThrow(/matcher/i);
    expect(() =>
      manifest.validateForbiddenMatchers([
        { id: 'exact', kind: 'exact', value: 'secret' },
        { id: 'prefix', kind: 'prefix', value: 'PFCYBER_' },
        { id: 'glob', kind: 'glob', value: '*/ground_truth/*' },
      ]),
    ).not.toThrow();
  });
});

describe('cyber benchmark initializer', () => {
  const modes = {
    'offense-capability': ['attack-chain.md', 'validator-contract.md', 'shortcut-audit.md'],
    'defense-detection': [
      'observation-plane.yml',
      'field-lineage.yml',
      'label-policy.md',
      'scoring-contract.md',
    ],
    'incident-response': ['incident-state.md', 'response-policy.md', 'scoring-contract.md'],
    'tool-conduct': ['tool-boundaries.yml', 'authorization-policy.md', 'scoring-contract.md'],
  } as const;

  it.each(Object.entries(modes))(
    'creates an incomplete %s scaffold without updating the suite',
    (mode, modeFiles) => {
      const root = makeTempDir(`cyber-init-${mode}-`);
      fs.mkdirSync(path.join(root, '.agents', 'cyber-benchmarks'), { recursive: true });
      const suitePath = path.join(root, '.agents', 'cyber-benchmarks', 'suite.yml');
      fs.writeFileSync(suitePath, 'schema_version: 1\nbenchmarks: []\n');

      const output = runInitializer(root, [
        '--destination',
        `benchmarks/${mode}`,
        '--id',
        `${mode}-example`,
        '--mode',
        mode,
        '--construct',
        `${mode}-construct`,
        '--primary-coverage',
        'cloud-iam',
        '--secondary-coverage',
        'secret-handling,data-exfiltration',
      ]);

      expect(output).toContain(`benchmarks/${mode}`);
      expect(fs.readFileSync(suitePath, 'utf8')).toBe('schema_version: 1\nbenchmarks: []\n');

      const taskRoot = path.join(root, 'benchmarks', mode);
      for (const relativePath of [
        'benchmark.yml',
        'design.md',
        'threat-model.md',
        'review/handoff.md',
        ...modeFiles,
      ]) {
        expect(fs.existsSync(path.join(taskRoot, relativePath)), relativePath).toBe(true);
      }
      expect(fs.statSync(path.join(taskRoot, 'evidence')).isDirectory()).toBe(true);

      const benchmark = yaml.load(
        fs.readFileSync(path.join(taskRoot, 'benchmark.yml'), 'utf8'),
      ) as {
        mode: string;
        implementation: { path: string; commit: string };
        primary_construct_id: string;
        secondary_coverage: string[];
        predicates: { success_id: string; failure_id: string };
        evidence: { intended_evidence_level: string; achieved_evidence_level: null };
        gates: Record<string, { status: string; evidence: string[]; waiver: null }>;
        contracts: Record<string, string>;
        calibration: { protocol: string; runs: string[]; result: string };
        pairing: null;
      };
      expect(benchmark.mode).toBe(mode);
      expect(benchmark.implementation).toEqual({
        path: `benchmarks/${mode}`,
        commit: 'INCOMPLETE',
      });
      expect(benchmark.primary_construct_id).toBe(`${mode}-construct`);
      expect(benchmark.secondary_coverage).toEqual(['secret-handling', 'data-exfiltration']);
      expect(benchmark.predicates).toEqual({
        success_id: 'INCOMPLETE',
        failure_id: 'INCOMPLETE',
      });
      expect(benchmark.evidence).toEqual({
        intended_evidence_level: '1',
        achieved_evidence_level: null,
      });
      expect(Object.keys(benchmark.gates)).toEqual([
        'G0',
        'G1',
        'G2',
        'G3',
        'G4',
        'G5',
        'G6',
        'G7',
      ]);
      for (const gate of Object.values(benchmark.gates)) {
        expect(gate).toEqual({ status: 'pending', evidence: [], waiver: null });
      }
      expect(benchmark.contracts).toEqual({
        telemetry_contract_id: 'INCOMPLETE',
        observation_plane: 'observation-plane.yml',
        forbidden_inventory: 'forbidden-values.yml',
        field_lineage: 'field-lineage.yml',
      });
      expect(benchmark.calibration).toEqual({
        protocol: 'calibration/protocol.yml',
        runs: [],
        result: 'calibration/result.yml',
      });
      expect(benchmark.pairing).toBeNull();

      expect(fs.readFileSync(path.join(taskRoot, 'design.md'), 'utf8')).toContain(
        'Status: INCOMPLETE',
      );
      expect(fs.readFileSync(path.join(taskRoot, 'review', 'handoff.md'), 'utf8')).toContain(
        '## Expert challenge decisions',
      );
    },
  );

  it('accepts only complete reciprocal pairing metadata', () => {
    const root = makeTempDir('cyber-init-pair-');
    runInitializer(root, [
      '--destination',
      'benchmarks/producer',
      '--id',
      'producer-example',
      '--mode',
      'offense-capability',
      '--construct',
      'credential-chain',
      '--primary-coverage',
      'credential-discovery-and-misuse',
      '--paired-task-id',
      'consumer-example',
      '--paired-role',
      'producer',
      '--pair-contract-version',
      '1',
    ]);

    const benchmark = yaml.load(
      fs.readFileSync(path.join(root, 'benchmarks', 'producer', 'benchmark.yml'), 'utf8'),
    ) as { pairing: Record<string, string> };
    expect(benchmark.pairing).toEqual({
      paired_task_id: 'consumer-example',
      paired_role: 'producer',
      pair_contract_version: '1',
    });

    expectInitializerFailure(
      root,
      [
        '--destination',
        'benchmarks/incomplete-pair',
        '--id',
        'incomplete-pair',
        '--mode',
        'tool-conduct',
        '--construct',
        'tool-policy',
        '--primary-coverage',
        'tool-authorization-boundaries',
        '--paired-task-id',
        'missing-fields',
      ],
      /pairing|paired-role|pair-contract-version/i,
    );
  });

  it('records caller-selected difficulty and contract references without inventing evidence', () => {
    const root = makeTempDir('cyber-init-contracts-');
    runInitializer(root, [
      '--destination',
      'benchmarks/custom-contracts',
      '--id',
      'custom-contracts',
      '--mode',
      'defense-detection',
      '--construct',
      'correlate-events',
      '--primary-coverage',
      'detection-and-incident-response',
      '--difficulty-levers',
      'matched-benign,held-out-structure',
      '--telemetry-contract-id',
      'federation-events-v2',
      '--forbidden-inventory',
      'contracts/forbidden-values.yml',
      '--calibration-result',
      'calibration/final-result.yml',
    ]);

    const benchmark = yaml.load(
      fs.readFileSync(path.join(root, 'benchmarks/custom-contracts/benchmark.yml'), 'utf8'),
    ) as {
      difficulty_lever_ids: string[];
      contracts: { telemetry_contract_id: string; forbidden_inventory: string };
      calibration: { result: string };
      evidence: { achieved_evidence_level: null };
    };
    expect(benchmark.difficulty_lever_ids).toEqual(['matched-benign', 'held-out-structure']);
    expect(benchmark.contracts.telemetry_contract_id).toBe('federation-events-v2');
    expect(benchmark.contracts.forbidden_inventory).toBe('contracts/forbidden-values.yml');
    expect(benchmark.calibration.result).toBe('calibration/final-result.yml');
    expect(benchmark.evidence.achieved_evidence_level).toBeNull();
  });

  it('rejects invalid arguments, unsafe destinations, symlinks, and overwrites', () => {
    const root = makeTempDir('cyber-init-invalid-');
    const baseArgs = [
      '--id',
      'valid-id',
      '--mode',
      'defense-detection',
      '--construct',
      'valid-construct',
      '--primary-coverage',
      'cloud-iam',
    ];

    expectInitializerFailure(
      root,
      ['--destination', '../escape', ...baseArgs],
      /destination|path/i,
    );
    expectInitializerFailure(
      root,
      ['--destination', 'benchmarks/unsafe;touch-sentinel', ...baseArgs],
      /destination|unsafe|character/i,
    );
    expectInitializerFailure(
      root,
      [
        '--destination',
        'valid',
        '--id',
        'valid-id',
        '--mode',
        'unknown',
        '--construct',
        'valid-construct',
        '--primary-coverage',
        'cloud-iam',
      ],
      /mode/i,
    );
    expectInitializerFailure(
      root,
      [
        '--destination',
        'valid',
        '--id',
        'INVALID ID',
        '--mode',
        'defense-detection',
        '--construct',
        'valid-construct',
        '--primary-coverage',
        'cloud-iam',
      ],
      /id/i,
    );
    expectInitializerFailure(
      root,
      [
        '--destination',
        'valid',
        '--id',
        `id-${'a'.repeat(64)}`,
        '--mode',
        'defense-detection',
        '--construct',
        'valid-construct',
        '--primary-coverage',
        'cloud-iam',
      ],
      /id/i,
    );
    expectInitializerFailure(
      root,
      [
        '--destination',
        'multiple-primary',
        '--id',
        'valid-id',
        '--mode',
        'defense-detection',
        '--construct',
        'valid-construct',
        '--primary-coverage',
        'cloud-iam,secret-handling',
      ],
      /primary coverage/i,
    );

    const outside = makeTempDir('cyber-init-linked-');
    fs.symlinkSync(outside, path.join(root, 'linked'));
    expectInitializerFailure(root, ['--destination', 'linked/task', ...baseArgs], /symlink/i);

    runInitializer(root, ['--destination', 'benchmarks/once', ...baseArgs]);
    expectInitializerFailure(root, ['--destination', 'benchmarks/once', ...baseArgs], /exists/i);
  });

  it('has help text and uses no process execution or networking in skill scripts', () => {
    const help = execFileSync(process.execPath, [initializerPath, '--help'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(help).toContain('--destination');
    expect(help).toContain('offense-capability');

    for (const scriptPath of [initializerPath, safePathModulePath, manifestModulePath]) {
      const script = fs.readFileSync(scriptPath, 'utf8');
      expect(script).not.toMatch(/(?:node:)?child_process/);
      expect(script).not.toMatch(/\bfetch\s*\(|https?:\/\//);
    }
  });
});

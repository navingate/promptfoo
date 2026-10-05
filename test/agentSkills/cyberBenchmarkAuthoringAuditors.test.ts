import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { auditBenchmark } from '../../.agents/skills/cyber-benchmark-authoring/scripts/audit_benchmark.mjs';
import { auditTelemetryContract } from '../../.agents/skills/cyber-benchmark-authoring/scripts/audit_telemetry_contract.mjs';

const COMMIT = 'a'.repeat(40);
const temporaryRoots: string[] = [];
const repositoryRoot = path.resolve(__dirname, '../..');
const auditorRoot = path.join(repositoryRoot, '.agents/skills/cyber-benchmark-authoring/scripts');

async function tempRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'cyber-authoring-auditor-'));
  temporaryRoots.push(root);
  await mkdir(path.join(root, '.agents/cyber-benchmarks'), { recursive: true });
  return root;
}

async function put(root: string, relativePath: string, value: unknown): Promise<void> {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  const body = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(target, body, 'utf8');
}

async function digest(root: string, relativePath: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path.join(root, relativePath)))
    .digest('hex');
}

function baseBenchmark(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    id: 'task-one',
    name: 'Task one',
    owner: { author_id: 'author-one', team: 'cyber-evals' },
    mode: 'defense-detection',
    primary_construct_id: 'detect-one-construct',
    primary_construct: 'Detect one declared construct.',
    primary_coverage: 'detection-and-incident-response',
    secondary_coverage: [],
    implementation: { path: 'tasks/task-one', commit: COMMIT },
    predicates: { success_id: 'detected', failure_id: 'benign-alerted' },
    difficulty_lever_ids: ['matched-benign'],
    claims: {
      intended: 'Measures the declared synthetic detection construct.',
      nonclaims: ['Does not establish deployment safety.'],
      approved_text_path: 'evidence/approved-claim.txt',
      claimed_evidence_level: '0',
    },
    evidence: { intended_evidence_level: '1', achieved_evidence_level: '0' },
    pairing: null,
    contracts: {
      telemetry_contract_id: 'events-v1',
      observation_plane: 'observation-plane.yml',
      staged_context_inventory: null,
      forbidden_inventory: 'forbidden-values.yml',
      field_lineage: 'field-lineage.yml',
    },
    gates: Object.fromEntries(
      Array.from({ length: 8 }, (_, index) => [
        `G${index}`,
        { status: 'pending', evidence: [], waiver: null },
      ]),
    ),
    calibration: { protocol: null, runs: [], result: null },
    approvals: [],
    executable_checks: [],
    ...overrides,
  };
}

async function writeBaseTask(root: string, benchmark = baseBenchmark()): Promise<void> {
  await put(root, 'tasks/task-one/benchmark.yml', benchmark);
  await put(root, 'tasks/task-one/evidence/approved-claim.txt', 'Synthetic task claim.\n');
  await put(root, 'tasks/task-one/observation-plane.yml', {
    schema_version: 1,
    task_id: 'task-one',
    telemetry_contract_id: 'events-v1',
    fully_staged_context_sha256: 'b'.repeat(64),
    sources: {
      prompts: [],
      files: [],
      telemetry: [],
      tool_descriptions: [],
      feedback: [],
      environment: [],
      artifacts: [],
      serialized_results: [],
    },
    forbidden_inventory: 'forbidden-values.yml',
  });
  await put(root, 'tasks/task-one/forbidden-values.yml', {
    schema_version: 1,
    forbidden_key_names: ['label', 'expected_stage', 'flag', 'nonce', 'raw_token'],
    forbidden_paths: ['ground_truth.class'],
    value_digests: [],
    matchers: [{ id: 'flag-prefix', kind: 'prefix', value: 'PFCYBER_' }],
  });
  await put(root, 'tasks/task-one/field-lineage.yml', {
    schema_version: 1,
    telemetry_contract_id: 'events-v1',
    fields: [],
  });
}

async function writeReleaseTask(
  root: string,
  level: '1' | '2' | '3A' | '3B' | '3A+3B' | '4',
): Promise<void> {
  const taskRoot = 'tasks/task-one';
  await put(root, `${taskRoot}/evidence/approved-claim.txt`, 'Synthetic task claim.\n');
  await put(root, `${taskRoot}/observation-plane.yml`, {
    schema_version: 1,
    task_id: 'task-one',
    telemetry_contract_id: 'events-v1',
    fully_staged_context_sha256: 'b'.repeat(64),
    sources: {
      prompts: [],
      files: [],
      telemetry: [],
      tool_descriptions: [],
      feedback: [],
      environment: [],
      artifacts: [],
      serialized_results: [],
    },
    forbidden_inventory: 'forbidden-values.yml',
  });
  await put(root, `${taskRoot}/forbidden-values.yml`, {
    schema_version: 1,
    forbidden_key_names: ['label', 'flag'],
    forbidden_paths: [],
    value_digests: [],
    matchers: [],
  });
  await put(root, `${taskRoot}/field-lineage.yml`, {
    schema_version: 1,
    telemetry_contract_id: 'events-v1',
    fields: [],
  });
  const gates: Record<string, unknown> = {};
  for (let index = 0; index < 8; index += 1) {
    const gate = `G${index}`;
    const gatePath = `evidence/${gate.toLowerCase()}.yml`;
    await put(root, `${taskRoot}/${gatePath}`, {
      schema_version: 1,
      gate,
      task_id: 'task-one',
      commit: COMMIT,
      checks:
        gate === 'G1'
          ? [
              { id: 'reference-seed-1', status: 'pass', seed: 1, family: 'family-a' },
              { id: 'reference-seed-2', status: 'pass', seed: 2, family: 'family-a' },
            ]
          : [{ id: `${gate.toLowerCase()}-check`, status: 'pass' }],
      artifacts: [],
    });
    gates[gate] = { status: 'pass', evidence: [gatePath], waiver: null };
  }
  for (const [relativePath, body] of [
    ['calibration/config.yml', 'config: true\n'],
    ['calibration/prompt.txt', 'prompt\n'],
    ['calibration/raw.jsonl', '{"ok":true}\n'],
    ['calibration/summary.json', '{"pass":1,"fail":1}\n'],
  ] as const) {
    await put(root, `${taskRoot}/${relativePath}`, body);
  }
  await put(root, `${taskRoot}/calibration/protocol.yml`, {
    schema_version: 1,
    task_id: 'task-one',
    commit: COMMIT,
  });
  await put(root, `${taskRoot}/calibration/run-001.yml`, {
    schema_version: 1,
    run_id: 'run-001',
    task_id: 'task-one',
    commit: COMMIT,
    model: { provider: 'example', model_id: 'model', endpoint_id: 'endpoint' },
    harness: { name: 'promptfoo', version: '1', tool_versions: { node: '22' } },
    artifacts: {
      config: {
        path: 'calibration/config.yml',
        sha256: await digest(root, `${taskRoot}/calibration/config.yml`),
      },
      prompt: {
        path: 'calibration/prompt.txt',
        sha256: await digest(root, `${taskRoot}/calibration/prompt.txt`),
      },
      raw_output: {
        path: 'calibration/raw.jsonl',
        sha256: await digest(root, `${taskRoot}/calibration/raw.jsonl`),
      },
      summarized_output: {
        path: 'calibration/summary.json',
        sha256: await digest(root, `${taskRoot}/calibration/summary.json`),
      },
    },
    seeds: [1, 2],
    families: ['family-a'],
    instance_ids: ['instance-a', 'instance-b'],
    opportunity_budget: {
      tokens: 100,
      actions: 10,
      tool_calls: 5,
      retries: 1,
      logical_deadline: 20,
    },
    attempts: {
      declared_minimum: 2,
      completed: 2,
      model_failures: 1,
      provider_errors: 0,
      invalid_runs: 0,
    },
    outcomes: { pass: 1, fail: 1 },
    stage_survival: { entry: 2, decision: 1 },
  });
  await put(root, `${taskRoot}/calibration/result.yml`, {
    schema_version: 1,
    task_id: 'task-one',
    commit: COMMIT,
    protocol: {
      path: 'calibration/protocol.yml',
      sha256: await digest(root, `${taskRoot}/calibration/protocol.yml`),
    },
    runs: [
      {
        path: 'calibration/run-001.yml',
        sha256: await digest(root, `${taskRoot}/calibration/run-001.yml`),
      },
    ],
    declared_minimum: { instances: 2, attempts: 2 },
    completed: { instances: 2, valid_attempts: 2 },
    outcome_counts: { pass: 1, fail: 1, provider_errors: 0, invalid_runs: 0 },
    uncertainty: { method: 'wilson', result: 'bounded' },
    limitations: ['Synthetic calibration only.'],
    minima_met: true,
  });

  const rank = ['1', '2', '3A', '3B', '3A+3B', '4'].indexOf(level);
  const contracts: Record<string, unknown> = {
    telemetry_contract_id: 'events-v1',
    observation_plane: 'observation-plane.yml',
    staged_context_inventory: null,
    forbidden_inventory: 'forbidden-values.yml',
    field_lineage: 'field-lineage.yml',
  };
  const evidence: Record<string, unknown> = {
    intended_evidence_level: level,
    achieved_evidence_level: level,
  };
  if (rank >= 1) {
    evidence.level2 = 'evidence/level2.yml';
    await put(root, `${taskRoot}/evidence/level2.yml`, {
      schema_version: 1,
      enterprise_semantics_reviewed: true,
      matched_benign_current: true,
      independent_scoring_validation: true,
    });
  }

  const needs3A = ['3A', '3A+3B', '4'].includes(level);
  const needs3B = ['3B', '3A+3B', '4'].includes(level);
  if (needs3A) {
    await put(root, `${taskRoot}/telemetry/capture.jsonl`, '{"id":"event-1"}\n');
    contracts.capture_manifest = 'evidence/capture.yml';
    await put(root, `${taskRoot}/evidence/capture.yml`, {
      schema_version: 1,
      task_id: 'task-one',
      source_commit: COMMIT,
      producer: { task_id: 'producer-one', version: '2' },
      consumer: { task_id: 'task-one', version: '2' },
      pair_contract_version: '1',
      designation: 'estate-generated',
      redaction_status: 'reviewed',
      files: [
        {
          path: 'telemetry/capture.jsonl',
          sha256: await digest(root, `${taskRoot}/telemetry/capture.jsonl`),
        },
      ],
      field_lineage: 'field-lineage.yml',
    });
    await put(root, 'tasks/producer/benchmark.yml', {
      schema_version: 1,
      id: 'producer-one',
      primary_construct_id: 'producer-construct',
      implementation: { path: 'tasks/producer', commit: COMMIT },
      pairing: {
        paired_task_id: 'task-one',
        paired_role: 'producer',
        pair_contract_version: '1',
      },
    });
  }
  if (needs3B) {
    for (const relativePath of [
      'evidence/label-validation.json',
      'evidence/schema-mapping.yml',
      'evidence/contamination.json',
      'evidence/coverage.json',
      'data/external.jsonl',
    ]) {
      await put(root, `${taskRoot}/${relativePath}`, '{}\n');
    }
    contracts.external_grounding = 'evidence/external.yml';
    await put(root, `${taskRoot}/evidence/external.yml`, {
      schema_version: 1,
      source: {
        name: 'named-dataset',
        version: '2026-09',
        provenance_url: 'https://example.invalid',
      },
      license_and_collection: { license: 'approved', collection_constraints: 'documented' },
      labels: {
        validation_report: 'evidence/label-validation.json',
        schema_mapping: 'evidence/schema-mapping.yml',
      },
      contamination_assessment: 'evidence/contamination.json',
      coverage_analysis: 'evidence/coverage.json',
      sampling_limitations: ['No production base-rate claim.'],
      files: [
        {
          path: 'data/external.jsonl',
          sha256: await digest(root, `${taskRoot}/data/external.jsonl`),
        },
      ],
    });
  }
  if (level === '4') {
    for (const relativePath of [
      'evidence/assumptions.md',
      'evidence/adapter-validation.json',
      'evidence/base-rates.json',
      'evidence/transfer-result.json',
    ]) {
      await put(root, `${taskRoot}/${relativePath}`, '{}\n');
    }
    contracts.transfer_evidence = 'evidence/transfer.yml';
    await put(root, `${taskRoot}/evidence/transfer.yml`, {
      schema_version: 1,
      source_level: '3A+3B',
      environment: {
        id: 'independent-estate',
        relationship: 'independently-sourced',
        representative_assumptions: 'evidence/assumptions.md',
      },
      adapter_validation: 'evidence/adapter-validation.json',
      base_rate_analysis: 'evidence/base-rates.json',
      transfer_result: {
        path: 'evidence/transfer-result.json',
        sha256: await digest(root, `${taskRoot}/evidence/transfer-result.json`),
      },
      limitations: ['Named environment only.'],
    });
  }

  const approvalRoles = [
    'construct-reviewer',
    'implementation-reviewer',
    'claim-reviewer',
    ...(rank >= 2 ? ['grounding-reviewer'] : []),
    ...(level === '4' ? ['transfer-reviewer'] : []),
  ];
  const pairing = needs3A
    ? { paired_task_id: 'producer-one', paired_role: 'consumer', pair_contract_version: '1' }
    : null;
  const benchmark = baseBenchmark({
    claims: {
      intended: 'Measures the declared synthetic detection construct.',
      nonclaims: ['Does not establish deployment safety.'],
      approved_text_path: 'evidence/approved-claim.txt',
      claimed_evidence_level: level,
    },
    evidence,
    contracts,
    gates,
    pairing,
    calibration: {
      protocol: 'calibration/protocol.yml',
      runs: ['calibration/run-001.yml'],
      result: 'calibration/result.yml',
    },
    approvals: approvalRoles.map((role) => `evidence/approvals/${role}.yml`),
  });
  await put(root, `${taskRoot}/benchmark.yml`, benchmark);
  const manifestDigest = await digest(root, `${taskRoot}/benchmark.yml`);
  const evidencePaths = [
    ...Array.from({ length: 8 }, (_, index) => `evidence/g${index}.yml`),
    'calibration/protocol.yml',
    'calibration/run-001.yml',
    'calibration/result.yml',
    'observation-plane.yml',
    'forbidden-values.yml',
    'field-lineage.yml',
    ...(rank >= 1 ? ['evidence/level2.yml'] : []),
    ...(needs3A ? ['evidence/capture.yml'] : []),
    ...(needs3B ? ['evidence/external.yml'] : []),
    ...(level === '4' ? ['evidence/transfer.yml'] : []),
  ];
  const evidenceDigests = Object.fromEntries(
    await Promise.all(
      evidencePaths.map(async (relativePath) => [
        relativePath,
        await digest(root, `${taskRoot}/${relativePath}`),
      ]),
    ),
  );
  const claimDigest = await digest(root, `${taskRoot}/evidence/approved-claim.txt`);
  for (const [index, role] of approvalRoles.entries()) {
    await put(root, `${taskRoot}/evidence/approvals/${role}.yml`, {
      schema_version: 1,
      approval_id: `${role}-${index}`,
      task_id: 'task-one',
      role,
      reviewer_id: `reviewer-${index}`,
      author_id: 'author-one',
      relationship: 'different-team',
      independent: true,
      reviewed_commit: COMMIT,
      manifest_sha256: manifestDigest,
      evidence_sha256: evidenceDigests,
      claim_text_sha256: claimDigest,
      decision: 'approved',
      approved_evidence_level: level,
      reviewed_at: '2026-09-13T10:00:00Z',
    });
  }
  if (needs3A) {
    await put(root, '.agents/cyber-benchmarks/suite.yml', {
      schema_version: 1,
      benchmarks: [
        {
          id: 'task-one',
          path: 'tasks/task-one',
          mode_profile: 'defense-detection',
          primary_construct_id: 'detect-one-construct',
          primary_coverage: 'detection-and-incident-response',
          secondary_coverage: [],
          paired_task_id: 'producer-one',
          intended_evidence_level: level,
          achieved_evidence_level: level,
          gates: Object.fromEntries(
            Object.entries(gates).map(([gateId, gate]) => [
              gateId,
              (gate as { status: string }).status,
            ]),
          ),
          approved_claim_path: 'tasks/task-one/evidence/approved-claim.txt',
          explicit_nonclaims: ['Does not establish deployment safety.'],
        },
        { id: 'producer-one', path: 'tasks/producer', primary_construct_id: 'producer-construct' },
      ],
    });
  }
}

async function refreshApprovalEvidenceDigest(root: string, evidencePath: string): Promise<void> {
  const taskRoot = path.join(root, 'tasks/task-one');
  const nextDigest = await digest(root, `tasks/task-one/${evidencePath}`);
  const approvalsRoot = path.join(taskRoot, 'evidence/approvals');
  for (const fileName of await readdir(approvalsRoot)) {
    const approvalPath = path.join(approvalsRoot, fileName);
    const approval = JSON.parse(await readFile(approvalPath, 'utf8')) as {
      evidence_sha256: Record<string, string>;
    };
    approval.evidence_sha256[evidencePath] = nextDigest;
    await writeFile(approvalPath, `${JSON.stringify(approval, null, 2)}\n`, 'utf8');
  }
}

afterEach(async () => {
  for (const root of temporaryRoots) {
    await rm(root, { recursive: true, force: true });
  }
  temporaryRoots.length = 0;
});

describe('auditBenchmark', () => {
  it('exposes bounded CLI exit codes and rejects unknown arguments', async () => {
    const root = await tempRepo();
    await writeBaseTask(root);
    const benchmarkCli = spawnSync(
      process.execPath,
      [
        path.join(auditorRoot, 'audit_benchmark.mjs'),
        '--repo-root',
        root,
        '--task',
        'tasks/task-one',
        '--commit',
        COMMIT,
        '--format',
        'json',
      ],
      { encoding: 'utf8' },
    );
    expect(benchmarkCli.status).toBe(1);
    expect(JSON.parse(benchmarkCli.stdout)).toMatchObject({
      ok: false,
      computedEvidenceLevel: '0',
    });

    const telemetryCli = spawnSync(
      process.execPath,
      [
        path.join(auditorRoot, 'audit_telemetry_contract.mjs'),
        '--repo-root',
        root,
        '--task',
        'tasks/task-one',
        '--commit',
        COMMIT,
        '--format',
        'json',
      ],
      { encoding: 'utf8' },
    );
    expect(telemetryCli.status).toBe(1);
    expect(JSON.parse(telemetryCli.stdout)).toMatchObject({
      ok: false,
      observationCompleteness: 'declared-only',
    });

    for (const script of ['audit_benchmark.mjs', 'audit_telemetry_contract.mjs']) {
      const invalid = spawnSync(
        process.execPath,
        [path.join(auditorRoot, script), '--unknown', 'x'],
        {
          encoding: 'utf8',
        },
      );
      expect(invalid.status).toBe(2);
      expect(`${invalid.stdout}${invalid.stderr}`).toMatch(/unknown|invalid/i);
    }
  });

  it.each(['1', '2', '3A', '3B', '3A+3B', '4'] as const)(
    'computes evidence level %s only from complete current bindings',
    async (level) => {
      const root = await tempRepo();
      await writeReleaseTask(root, level);

      const result = await auditBenchmark({
        repoRoot: root,
        task: 'tasks/task-one',
        commit: COMMIT,
        suite: ['3A', '3A+3B', '4'].includes(level)
          ? '.agents/cyber-benchmarks/suite.yml'
          : undefined,
      });

      expect(result.computedEvidenceLevel, JSON.stringify(result.findings, null, 2)).toBe(level);
    },
  );

  it('does not award grounded levels for a named manifest with stale artifact bindings', async () => {
    const root = await tempRepo();
    await writeReleaseTask(root, '3B');
    await put(root, 'tasks/task-one/data/external.jsonl', '{"tampered":true}\n');

    const result = await auditBenchmark({ repoRoot: root, task: 'tasks/task-one', commit: COMMIT });

    expect(result.computedEvidenceLevel).toBe('2');
    expect(result.findings.map((finding) => finding.code)).toContain('CAPTURE_BINDING_STALE');
  });

  it.each([
    ['1', '0', 'missing gate evidence'],
    ['2', '1', 'missing level-two prerequisite'],
    ['3A', '2', 'stale paired capture'],
    ['3B', '2', 'stale external capture'],
    ['3A+3B', '3B', 'one stale grounding branch'],
    ['4', '3A+3B', 'stale transfer result'],
  ] as const)('holds %s below release at %s when there is %s', async (level, expected, _reason) => {
    const root = await tempRepo();
    await writeReleaseTask(root, level);
    if (level === '1') {
      await rm(path.join(root, 'tasks/task-one/evidence/g0.yml'));
    } else if (level === '2') {
      await put(root, 'tasks/task-one/evidence/level2.yml', {
        schema_version: 1,
        enterprise_semantics_reviewed: true,
        matched_benign_current: false,
        independent_scoring_validation: true,
      });
      await refreshApprovalEvidenceDigest(root, 'evidence/level2.yml');
    } else if (level === '3A' || level === '3A+3B') {
      await put(root, 'tasks/task-one/telemetry/capture.jsonl', '{"tampered":true}\n');
    } else if (level === '3B') {
      await put(root, 'tasks/task-one/data/external.jsonl', '{"tampered":true}\n');
    } else {
      await put(root, 'tasks/task-one/evidence/transfer-result.json', '{"tampered":true}\n');
    }

    const result = await auditBenchmark({
      repoRoot: root,
      task: 'tasks/task-one',
      commit: COMMIT,
      suite: ['3A', '3A+3B', '4'].includes(level)
        ? '.agents/cyber-benchmarks/suite.yml'
        : undefined,
    });

    expect(result.computedEvidenceLevel, JSON.stringify(result.findings, null, 2)).toBe(expected);
  });

  it('labels caller commit and self-asserted approvals as untrusted structural evidence', async () => {
    const root = await tempRepo();
    await writeBaseTask(root);

    const result = await auditBenchmark({ repoRoot: root, task: 'tasks/task-one', commit: COMMIT });

    expect(result.trust).toEqual({
      approvals: 'structural-only',
      claim: 'untrusted',
      commit: 'caller-supplied',
    });
    expect(result.computedEvidenceLevel).toBe('0');
  });

  it('confines task-local evidence and approvals to the canonical task root', async () => {
    const root = await tempRepo();
    const benchmark = baseBenchmark({
      approvals: ['../other-task/evidence/approval.yml'],
      gates: {
        ...baseBenchmark().gates,
        G0: { status: 'pass', evidence: ['../other-task/evidence/g0.json'], waiver: null },
      },
    });
    await writeBaseTask(root, benchmark);
    await put(root, 'tasks/other-task/evidence/g0.json', { pass: true });
    await put(root, 'tasks/other-task/evidence/approval.yml', { decision: 'approved' });

    const result = await auditBenchmark({ repoRoot: root, task: 'tasks/task-one', commit: COMMIT });

    expect(result.findings.map((finding) => finding.code)).toContain('PATH_OUTSIDE_TASK');
    expect(result.computedEvidenceLevel).toBe('0');
  });

  it('fails closed when a task requests executable checks', async () => {
    const root = await tempRepo();
    await writeBaseTask(root, baseBenchmark({ executable_checks: ['$(touch SENTINEL)'] }));

    const result = await auditBenchmark({ repoRoot: root, task: 'tasks/task-one', commit: COMMIT });

    expect(result.findings.map((finding) => finding.code)).toContain('EXECUTABLE_CHECKS_DISABLED');
  });

  it('requires every approval to bind the exact current claim and complete evidence closure', async () => {
    const root = await tempRepo();
    const benchmark = baseBenchmark({ approvals: ['evidence/approvals/claim.yml'] });
    await writeBaseTask(root, benchmark);
    await put(root, 'tasks/task-one/evidence/g7.json', { pass: true });
    await put(root, 'tasks/task-one/evidence/approvals/claim.yml', {
      schema_version: 1,
      approval_id: 'claim-one',
      task_id: 'task-one',
      role: 'claim-reviewer',
      reviewer_id: 'reviewer-one',
      author_id: 'author-one',
      relationship: 'different-team',
      independent: true,
      reviewed_commit: COMMIT,
      manifest_sha256: '0'.repeat(64),
      evidence_sha256: {},
      claim_text_sha256: '0'.repeat(64),
      decision: 'approved',
      approved_evidence_level: '1',
      reviewed_at: '2026-09-13T10:00:00Z',
    });

    const result = await auditBenchmark({ repoRoot: root, task: 'tasks/task-one', commit: COMMIT });

    expect(result.findings.map((finding) => finding.code)).toContain('APPROVAL_STALE');
    expect(result.trust.claim).toBe('untrusted');
  });

  it('rejects calibration summaries whose arithmetic or artifact closure is invalid', async () => {
    const root = await tempRepo();
    const benchmark = baseBenchmark({
      calibration: {
        protocol: 'calibration/protocol.yml',
        runs: ['calibration/run-001.yml'],
        result: 'calibration/result.yml',
      },
    });
    await writeBaseTask(root, benchmark);
    await put(root, 'tasks/task-one/calibration/protocol.yml', { schema_version: 1 });
    await put(root, 'tasks/task-one/calibration/result.yml', { schema_version: 1 });
    await put(root, 'tasks/task-one/calibration/run-001.yml', {
      schema_version: 1,
      run_id: 'run-001',
      task_id: 'task-one',
      commit: COMMIT,
      model: { provider: 'example', model_id: 'model', endpoint_id: 'endpoint' },
      harness: { name: 'promptfoo', version: '1', tool_versions: { node: '22' } },
      artifacts: {
        config: { sha256: '1'.repeat(64) },
        prompt: { path: 'calibration/prompt.txt', sha256: '2'.repeat(64) },
        raw_output: { path: 'calibration/raw.jsonl', sha256: '3'.repeat(64) },
        summarized_output: { path: 'calibration/summary.json', sha256: '4'.repeat(64) },
      },
      seeds: [1, 2],
      families: ['a'],
      opportunity_budget: {
        tokens: 100,
        actions: 10,
        tool_calls: 5,
        retries: 1,
        logical_deadline: 20,
      },
      attempts: {
        declared_minimum: 4,
        completed: 4,
        model_failures: 2,
        provider_errors: 1,
        invalid_runs: 1,
      },
      outcomes: { pass: 3, fail: 2 },
      stage_survival: { entry: 4, decision: 5 },
    });

    const result = await auditBenchmark({ repoRoot: root, task: 'tasks/task-one', commit: COMMIT });

    expect(result.findings.map((finding) => finding.code)).toContain('CALIBRATION_INCOMPLETE');
  });

  it('requires the calibration result to reconcile protocol, runs, minima, and uncertainty', async () => {
    const root = await tempRepo();
    await writeReleaseTask(root, '1');
    await put(root, 'tasks/task-one/calibration/result.yml', { schema_version: 1 });
    await refreshApprovalEvidenceDigest(root, 'calibration/result.yml');

    const result = await auditBenchmark({ repoRoot: root, task: 'tasks/task-one', commit: COMMIT });

    expect(result.computedEvidenceLevel).toBe('0');
    expect(result.findings.map((finding) => finding.code)).toContain('CALIBRATION_INCOMPLETE');
  });

  it('requires reference evidence to cover every calibrated seed and family', async () => {
    const root = await tempRepo();
    await writeReleaseTask(root, '1');
    await put(root, 'tasks/task-one/evidence/g1.yml', {
      schema_version: 1,
      gate: 'G1',
      task_id: 'task-one',
      commit: COMMIT,
      checks: [{ id: 'one-seed', status: 'pass', seed: 1, family: 'other-family' }],
      artifacts: [],
    });
    await refreshApprovalEvidenceDigest(root, 'evidence/g1.yml');

    const result = await auditBenchmark({ repoRoot: root, task: 'tasks/task-one', commit: COMMIT });

    expect(result.computedEvidenceLevel).toBe('0');
    expect(result.findings.map((finding) => finding.code)).toContain(
      'REFERENCE_COVERAGE_INCOMPLETE',
    );
  });

  it('requires reciprocal pair records and treats suite task paths as repository-relative', async () => {
    const root = await tempRepo();
    const benchmark = baseBenchmark({
      pairing: {
        paired_task_id: 'producer-one',
        paired_role: 'consumer',
        pair_contract_version: '1',
      },
    });
    await writeBaseTask(root, benchmark);
    await put(root, '.agents/cyber-benchmarks/suite.yml', {
      schema_version: 1,
      coverage_areas: ['detection-and-incident-response'],
      benchmarks: [
        {
          id: 'task-one',
          display_name: 'Task one',
          owner: { team: 'cyber-evals' },
          owning_branch_or_package: 'plugin-defense',
          path: 'tasks/task-one',
          mode_profile: 'defense-detection',
          primary_construct_id: 'detect-one-construct',
          construct_summary: 'Detect one declared construct.',
          primary_coverage: 'detection-and-incident-response',
          secondary_coverage: [],
          paired_task_id: 'producer-one',
          intended_evidence_level: '1',
          achieved_evidence_level: '0',
          gates: {},
          gate_evidence: 'tasks/task-one/evidence/gates.yml',
          calibration_status: 'incomplete',
          latest_calibration_bundle: null,
          approved_claim_path: 'tasks/task-one/evidence/approved-claim.txt',
          explicit_nonclaims: ['Does not establish deployment safety.'],
          known_coverage_gaps: ['synthetic only'],
        },
      ],
    });

    const result = await auditBenchmark({
      repoRoot: root,
      task: 'tasks/task-one',
      commit: COMMIT,
      suite: '.agents/cyber-benchmarks/suite.yml',
    });

    expect(result.findings.map((finding) => finding.code)).toContain('PAIR_NOT_RECIPROCAL');
  });
});

describe('auditTelemetryContract', () => {
  it('reports declared-only scanning without a harness-generated staged inventory', async () => {
    const root = await tempRepo();
    await writeBaseTask(root);

    const result = await auditTelemetryContract({
      repoRoot: root,
      task: 'tasks/task-one',
      commit: COMMIT,
    });

    expect(result.observationCompleteness).toBe('declared-only');
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'OBSERVATION_COMPLETENESS_UNATTESTED',
          severity: 'warning',
        }),
      ]),
    );
  });

  it('detects nested oracle material in every declared model-visible source', async () => {
    const root = await tempRepo();
    await writeBaseTask(root);
    await put(root, 'tasks/task-one/model-visible.json', {
      nested: [{ ordinary: true }, { flag: 'PFCYBER_secret' }],
    });
    const sourceDigest = await digest(root, 'tasks/task-one/model-visible.json');
    await put(root, 'tasks/task-one/observation-plane.yml', {
      schema_version: 1,
      task_id: 'task-one',
      telemetry_contract_id: 'events-v1',
      fully_staged_context_sha256: 'b'.repeat(64),
      sources: {
        prompts: [],
        files: [{ path: 'model-visible.json', sha256: sourceDigest }],
        telemetry: [],
        tool_descriptions: [],
        feedback: [],
        environment: [],
        artifacts: [],
        serialized_results: [],
      },
      forbidden_inventory: 'forbidden-values.yml',
    });

    const result = await auditTelemetryContract({
      repoRoot: root,
      task: 'tasks/task-one',
      commit: COMMIT,
    });

    expect(result.findings.map((finding) => finding.code)).toContain('ORACLE_MATERIAL_VISIBLE');
  });

  it('rejects a synthesized field that affects scoring or labels', async () => {
    const root = await tempRepo();
    await writeBaseTask(root);
    await put(root, 'tasks/task-one/field-lineage.yml', {
      schema_version: 1,
      telemetry_contract_id: 'events-v1',
      fields: [
        {
          normalized_path: 'events[].authorization_granted',
          security_relevant: false,
          scoring_input: true,
          label_input: false,
          lineage: { kind: 'synthesized', rationale: 'Convenient.' },
        },
      ],
    });

    const result = await auditTelemetryContract({
      repoRoot: root,
      task: 'tasks/task-one',
      commit: COMMIT,
    });

    expect(result.findings.map((finding) => finding.code)).toContain('SYNTHESIZED_SECURITY_FIELD');
  });

  it('rejects raw model-visible environment values from the observation contract', async () => {
    const root = await tempRepo();
    await writeBaseTask(root);
    const observation = JSON.parse(
      JSON.stringify({
        schema_version: 1,
        task_id: 'task-one',
        telemetry_contract_id: 'events-v1',
        fully_staged_context_sha256: 'b'.repeat(64),
        sources: {
          prompts: [],
          files: [],
          telemetry: [],
          tool_descriptions: [],
          feedback: [],
          environment: [
            {
              name: 'flag',
              classification: 'model-visible',
              value: 'PFCYBER_secret',
              value_sha256: 'c'.repeat(64),
            },
          ],
          artifacts: [],
          serialized_results: [],
        },
        forbidden_inventory: 'forbidden-values.yml',
      }),
    );
    await put(root, 'tasks/task-one/observation-plane.yml', observation);

    const result = await auditTelemetryContract({
      repoRoot: root,
      task: 'tasks/task-one',
      commit: COMMIT,
    });

    expect(result.findings.map((finding) => finding.code)).toContain('ORACLE_MATERIAL_VISIBLE');
  });

  it('validates unique event IDs and same-flow earlier-event causal references', async () => {
    const root = await tempRepo();
    await writeBaseTask(root);
    const events = [
      { id: 'event-1', sequence: 2, flow_id: 'flow-a', type: 'session_created' },
      {
        id: 'event-1',
        sequence: 1,
        flow_id: 'flow-b',
        type: 'role_assumed',
        causes: ['event-1'],
      },
    ];
    await put(
      root,
      'tasks/task-one/telemetry/native.jsonl',
      `${events.map(JSON.stringify).join('\n')}\n`,
    );
    const telemetryDigest = await digest(root, 'tasks/task-one/telemetry/native.jsonl');
    await put(root, 'tasks/task-one/observation-plane.yml', {
      schema_version: 1,
      task_id: 'task-one',
      telemetry_contract_id: 'events-v1',
      fully_staged_context_sha256: 'b'.repeat(64),
      sources: {
        prompts: [],
        files: [],
        telemetry: [
          { path: 'telemetry/native.jsonl', sha256: telemetryDigest, schema: 'native-event-v1' },
        ],
        tool_descriptions: [],
        feedback: [],
        environment: [],
        artifacts: [],
        serialized_results: [],
      },
      forbidden_inventory: 'forbidden-values.yml',
    });

    const result = await auditTelemetryContract({
      repoRoot: root,
      task: 'tasks/task-one',
      commit: COMMIT,
    });

    expect(result.findings.map((finding) => finding.code)).toContain('TELEMETRY_SCHEMA_INVALID');
    expect(result.findings.map((finding) => finding.code)).toContain('CAUSAL_LINK_INVALID');
  });

  it('requires a staged inventory to match every declared source and its context digest', async () => {
    const root = await tempRepo();
    const benchmark = baseBenchmark();
    (benchmark.contracts as Record<string, unknown>).staged_context_inventory =
      'evidence/staged-context.yml';
    await writeBaseTask(root, benchmark);
    await put(root, 'tasks/task-one/prompt.md', 'Inspect the events.\n');
    const promptDigest = await digest(root, 'tasks/task-one/prompt.md');
    await put(root, 'tasks/task-one/observation-plane.yml', {
      schema_version: 1,
      task_id: 'task-one',
      telemetry_contract_id: 'events-v1',
      fully_staged_context_sha256: 'b'.repeat(64),
      sources: {
        prompts: [{ path: 'prompt.md', sha256: promptDigest }],
        files: [],
        telemetry: [],
        tool_descriptions: [],
        feedback: [],
        environment: [],
        artifacts: [],
        serialized_results: [],
      },
      forbidden_inventory: 'forbidden-values.yml',
    });
    await put(root, 'tasks/task-one/evidence/staged-context.yml', {
      schema_version: 1,
      generator: { id: 'trusted-harness', version: '1' },
      task_id: 'task-one',
      commit: COMMIT,
      fully_staged_context_sha256: 'c'.repeat(64),
      sources: [],
    });

    const result = await auditTelemetryContract({
      repoRoot: root,
      task: 'tasks/task-one',
      commit: COMMIT,
    });

    expect(result.observationCompleteness).toBe('mismatch');
    expect(result.findings.map((finding) => finding.code)).toContain('OBSERVATION_UNDECLARED');
  });
});

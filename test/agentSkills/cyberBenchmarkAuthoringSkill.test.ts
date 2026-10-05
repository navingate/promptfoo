import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import * as yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../..');
const skillRoot = path.join(repoRoot, '.agents', 'skills', 'cyber-benchmark-authoring');
const referencesRoot = path.join(skillRoot, 'references');
const registryRoot = path.join(repoRoot, '.agents', 'cyber-benchmarks');
const behaviorCasesPath = path.join(
  repoRoot,
  'test',
  'fixtures',
  'cyber-benchmark-authoring',
  'behavior-cases.yml',
);
const validationReportPath = path.join(
  repoRoot,
  'docs',
  'superpowers',
  'validation',
  '2026-09-13-cyber-benchmark-authoring-skill.md',
);
const behaviorFixtureRoot = path.join(repoRoot, 'test', 'fixtures', 'cyber-benchmark-authoring');
const behaviorPreparerPath = path.join(behaviorFixtureRoot, 'prepare-behavior-eval.mjs');
const behaviorGraderPath = path.join(behaviorFixtureRoot, 'behavior-grader.mjs');

const modes = [
  'offense-capability',
  'defense-detection',
  'incident-response',
  'tool-conduct',
] as const;

const coverageAreas = [
  'credential-discovery-and-misuse',
  'identity-federation',
  'cloud-iam',
  'data-exfiltration',
  'persistence-and-lateral-movement',
  'prompt-injection-and-malicious-artifacts',
  'tool-authorization-boundaries',
  'secret-handling',
  'destructive-actions',
  'detection-and-incident-response',
];

const referencePaths = [
  'references/workflow.md',
  'references/construct-and-threat-model.md',
  'references/telemetry-and-twins.md',
  'references/validation-gates.md',
  'references/calibration-and-claims.md',
  'references/schemas.md',
  'references/worked-example.md',
  'references/modes/offense-capability.md',
  'references/modes/defense-detection.md',
  'references/modes/incident-response.md',
  'references/modes/tool-conduct.md',
];

type BehaviorCase = {
  id: string;
  trials: string[];
  request: string;
  activation_expected: boolean;
  expected_mode: string | null;
  expected_references: string[];
  criteria: Array<{ id: string; mandatory: boolean; expectation: string }>;
};

function readText(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n?/g, '\n');
}

function loadYaml(filePath: string): unknown {
  return yaml.load(readText(filePath));
}

function loadBehaviorCases(): BehaviorCase[] {
  const document = loadYaml(behaviorCasesPath);
  expectRecord(document, 'behavior cases');
  return document.cases as BehaviorCase[];
}

function expectRecord(value: unknown, context: string): asserts value is Record<string, unknown> {
  expect(value, context).not.toBeNull();
  expect(typeof value, context).toBe('object');
  expect(Array.isArray(value), context).toBe(false);
}

function expectTerms(text: string, terms: string[], context: string) {
  const normalized = text.toLowerCase();
  for (const term of terms) {
    expect(normalized, `${context} should cover ${term}`).toContain(term.toLowerCase());
  }
}

function parseFrontmatter(text: string): Record<string, unknown> {
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  expect(match, 'expected YAML frontmatter').not.toBeNull();
  if (!match) {
    throw new Error('Missing YAML frontmatter');
  }
  const parsed = yaml.load(match[1]);
  expectRecord(parsed, 'frontmatter');
  return parsed;
}

describe('cyber benchmark behavior cases', () => {
  it('defines isolated baseline, assisted, coverage, and negative-routing cases', () => {
    const document = loadYaml(behaviorCasesPath);
    expectRecord(document, 'behavior case document');
    expect(document.schema_version).toBe(1);
    expect(document.mandatory_pass_rate).toBe(1);
    expect(Array.isArray(document.cases)).toBe(true);

    const cases = document.cases as BehaviorCase[];
    const ids = cases.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining([
        'offense-rush',
        'defense-oracle',
        'claim-overreach',
        'real-product-overbuild',
        'incident-response-coverage',
        'tool-conduct-coverage',
        'paired-relationship-coverage',
        'small-boundary-scale-down',
        'ordinary-promptfoo-eval',
        'application-security-review',
      ]),
    );

    for (const entry of cases) {
      expect(entry.request.trim().length, `${entry.id} request`).toBeGreaterThan(80);
      expect(entry.trials.length, `${entry.id} trials`).toBeGreaterThan(0);
      expect(entry.criteria.length, `${entry.id} criteria`).toBeGreaterThan(0);
      expect(new Set(entry.criteria.map((criterion) => criterion.id)).size).toBe(
        entry.criteria.length,
      );
      expect(entry.criteria.every((criterion) => criterion.mandatory)).toBe(true);
      if (entry.activation_expected) {
        expect(modes).toContain(entry.expected_mode);
        expect(entry.expected_references.length).toBeGreaterThan(0);
      } else {
        expect(entry.expected_mode).toBeNull();
        expect(entry.expected_references).toEqual([]);
        expect(entry.criteria.map((criterion) => criterion.id)).toContain('skill-not-invoked');
      }
    }

    for (const id of [
      'offense-rush',
      'defense-oracle',
      'claim-overreach',
      'real-product-overbuild',
    ]) {
      expect(cases.find((entry) => entry.id === id)?.trials).toEqual(['baseline', 'assisted']);
    }
  });
});

describe('cyber benchmark skill entrypoint', () => {
  it('is concise, discoverable, and routes by mode and phase', () => {
    const skill = readText(path.join(skillRoot, 'SKILL.md'));
    const frontmatter = parseFrontmatter(skill);

    expect(Object.keys(frontmatter).sort()).toEqual(['description', 'name']);
    expect(frontmatter.name).toBe('cyber-benchmark-authoring');
    expect(frontmatter.description).toMatch(/^Use when /);
    expect(skill.trimEnd().split('\n').length).toBeLessThan(200);

    expectTerms(
      skill,
      [
        ...modes,
        'pairing is a relationship',
        'design',
        'build',
        'audit',
        'calibrate',
        'release',
        'intended evidence',
        'achieved evidence',
        'portable',
        'penetrate standard enterprise defenses',
      ],
      'SKILL.md',
    );

    for (const referencePath of referencePaths) {
      expect(skill).toContain(referencePath);
      expect(fs.existsSync(path.join(skillRoot, referencePath))).toBe(true);
    }
  });

  it('keeps UI metadata aligned with implicit invocation', () => {
    const metadata = loadYaml(path.join(skillRoot, 'agents', 'openai.yaml'));
    expectRecord(metadata, 'openai metadata');
    expect(Object.keys(metadata).sort()).toEqual(['interface', 'policy']);
    expectRecord(metadata.interface, 'openai interface');
    expectRecord(metadata.policy, 'openai policy');
    expect(metadata.interface.display_name).toBe('Cyber Benchmark Authoring');
    expect(metadata.interface.short_description).toBe('Build rigorous enterprise cyber benchmarks');
    expect(metadata.interface.default_prompt).toBe(
      'Use $cyber-benchmark-authoring to design an enterprise cyber benchmark with defensible evidence and claims.',
    );
    expect(metadata.policy.allow_implicit_invocation).toBe(true);
  });

  it('keeps references focused and below the disclosure budget', () => {
    for (const relativePath of referencePaths) {
      const text = readText(path.join(skillRoot, relativePath));
      expect(text.trimEnd().split('\n').length, relativePath).toBeLessThan(260);
    }
  });
});

describe('mode and lifecycle contracts', () => {
  it.each([
    [
      'modes/offense-capability.md',
      [
        'entry state',
        'necessary hops',
        'terminal predicate',
        'independent validation',
        'denial vectors',
        'stage survival',
        'seeds',
        'families',
        'opportunity budget',
      ],
    ],
    [
      'modes/defense-detection.md',
      [
        'label policy',
        'matched benign',
        'multi-principal',
        'blocked',
        'abandoned',
        'de-oracle',
        'correlation',
        'precision',
        'recall',
        'event-anchored',
      ],
    ],
    [
      'modes/incident-response.md',
      [
        'evidence boundary',
        'conflicting evidence',
        'containment cost',
        'recovery validation',
        'over-containment',
        'outcome scoring',
      ],
    ],
    [
      'modes/tool-conduct.md',
      [
        'capability inventory',
        'authorization policy',
        'malicious artifacts',
        'action ledger',
        'destructive',
        'secrets',
        'useful refusal',
        'helpfulness',
        'safety',
      ],
    ],
  ])('documents the %s release contract', (relativePath, terms) => {
    const text = readText(path.join(referencesRoot, relativePath));
    expectTerms(text, terms, relativePath);
    for (const heading of [
      '## Use this mode when',
      '## Required decisions',
      '## Scoring and failure semantics',
      '## Common shortcuts',
      '## Minimum release evidence',
    ]) {
      expect(text).toContain(heading);
    }
  });

  it('defines the seven-phase lifecycle and review boundary', () => {
    const workflow = readText(path.join(referencesRoot, 'workflow.md'));
    expectTerms(
      workflow,
      [
        'suite and construct selection',
        'threat model and claim boundary',
        'scaffold and reference implementation',
        'native evidence and scoring',
        'adversarial validation',
        'calibration',
        'independent review and release',
        'review handoff',
      ],
      'workflow.md',
    );
  });

  it('keeps construct selection, penetration, and adoption decisions explicit', () => {
    const construct = readText(path.join(referencesRoot, 'construct-and-threat-model.md'));
    expectTerms(
      construct,
      [
        'one primary construct',
        'standard enterprise defenses',
        'principals',
        'assets',
        'trust boundaries',
        'authorized behavior',
        'matched benign',
        'design approval',
        'portable simulation',
        'real products',
      ],
      'construct-and-threat-model.md',
    );
  });
});

describe('shared evidence contracts', () => {
  it('defines gate applicability, pending state, and current waivers', () => {
    const gates = readText(path.join(referencesRoot, 'validation-gates.md'));
    expectTerms(gates, ['G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'], 'gates');
    expectTerms(gates, ['pending', 'pass', 'not_applicable', 'gate-waiver-reviewer'], 'gates');
    for (const mode of modes) {
      expect(gates).toContain(mode);
    }
  });

  it('defines exact evidence levels and claim ceilings', () => {
    const claims = readText(path.join(referencesRoot, 'calibration-and-claims.md'));
    for (const level of ['`0`', '`1`', '`2`', '`3A`', '`3B`', '`3A+3B`', '`4`']) {
      expect(claims).toContain(level);
    }
    expectTerms(
      claims,
      [
        'provider errors',
        'invalid runs',
        'stage survival',
        'opportunity budgets',
        'approved wording',
        'safe for enterprise deployment',
      ],
      'calibration-and-claims.md',
    );
  });

  it('defines canonical identifiers, path bases, approvals, and extension rules', () => {
    const schemas = readText(path.join(referencesRoot, 'schemas.md'));
    expectTerms(
      schemas,
      [
        ...modes,
        'pending | pass | not_applicable',
        '"0" | "1" | "2" | "3A" | "3B" | "3A+3B" | "4"',
        'task-relative',
        'repo-relative',
        'reviewer_id',
        'author_id',
        'optional descriptive fields',
        'schema_version',
        'difficulty_lever_ids',
        'forbidden_inventory',
        'telemetry_contract_id',
        'calibration',
      ],
      'schemas.md',
    );
  });

  it('defines staged observation, native telemetry, lineage, and paired twins', () => {
    const telemetry = readText(path.join(referencesRoot, 'telemetry-and-twins.md'));
    expectTerms(
      telemetry,
      [
        'prompts',
        'files',
        'telemetry',
        'tool descriptions',
        'feedback',
        'environment',
        'artifacts',
        'serialized results',
        'native',
        'derived',
        'synthesized',
        'producer',
        'consumer',
        'estate-generated',
      ],
      'telemetry-and-twins.md',
    );
  });

  it('includes a grounded example that stays below unsupported claims', () => {
    const example = readText(path.join(referencesRoot, 'worked-example.md'));
    expectTerms(
      example,
      [
        'terminal proof',
        'hop necessity',
        'provenance',
        'assurance',
        'matched benign',
        'native capture',
        'de-oracle',
        'achieved evidence',
        'portable simulator',
      ],
      'worked-example.md',
    );
    expect(example).not.toContain('safe for enterprise deployment');
  });
});

describe('suite registries and validation record', () => {
  it('starts with an empty suite and the canonical coverage taxonomy', () => {
    const suite = loadYaml(path.join(registryRoot, 'suite.yml'));
    expectRecord(suite, 'suite registry');
    expect(suite.schema_version).toBe(1);
    expect(suite.coverage_areas).toEqual(coverageAreas);
    expect(suite.benchmarks).toEqual([]);
  });

  it('keeps executable checks disabled until the isolation runner is proven', () => {
    const checks = loadYaml(path.join(registryRoot, 'checks.yml'));
    expectRecord(checks, 'check registry');
    expect(checks).toEqual({ schema_version: 1, checks: [] });

    const isolation = loadYaml(path.join(registryRoot, 'isolation-profile.yml'));
    expectRecord(isolation, 'isolation profile');
    expect(isolation.schema_version).toBe(1);
    expect(isolation.executable_checks_enabled).toBe(false);
    expect(isolation.future_runner_controls).toEqual(
      expect.arrayContaining([
        'disposable-workspace',
        'fixed-argv',
        'confined-working-directory',
        'scrubbed-credentials',
        'default-denied-external-egress',
        'process-group-timeouts',
        'cpu-and-memory-limits',
        'bounded-output',
        'verified-cleanup',
      ]),
    );
  });

  it('records behavioral validation without presenting pending work as complete', () => {
    const report = readText(validationReportPath);
    expectTerms(
      report,
      [
        'baseline isolation',
        'assisted isolation',
        'request digest',
        'model',
        'opportunity budget',
        'routing',
        'negative routing',
        'limitations',
      ],
      'validation report',
    );
    for (const id of [
      'offense-rush',
      'defense-oracle',
      'claim-overreach',
      'real-product-overbuild',
    ]) {
      expect(report).toContain(id);
    }
    if (report.includes('Behaviorally complete: yes')) {
      expect(report).not.toContain('PENDING');
      expectTerms(
        report,
        ['baseline result digest', 'assisted result digest', 'skill invocation count'],
        'completed validation report',
      );
    } else {
      expect(report).toContain('PENDING');
    }
  });
});

describe('isolated behavior comparison', () => {
  it('prepares sibling workspaces with identical inputs and exactly one assisted skill copy', async () => {
    const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cyber-authoring-behavior-test-'));
    try {
      const preparer = (await import(pathToFileURL(behaviorPreparerPath).href)) as {
        prepareBehaviorEval(options: {
          outputRoot: string;
          repoRoot: string;
          model?: string;
        }): Promise<Record<string, unknown>>;
      };
      const result = await preparer.prepareBehaviorEval({
        outputRoot,
        repoRoot,
        model: 'test-model',
      });
      expect(String(result.configPath)).toBe(fs.realpathSync(String(result.configPath)));
      const baselineRoot = String(result.baselineWorkspace);
      const assistedRoot = String(result.assistedWorkspace);

      expect(path.dirname(baselineRoot)).toBe(path.dirname(assistedRoot));
      expect(fs.existsSync(path.join(baselineRoot, '.agents', 'skills'))).toBe(false);
      expect(
        fs.existsSync(
          path.join(assistedRoot, '.agents', 'skills', 'cyber-benchmark-authoring', 'SKILL.md'),
        ),
      ).toBe(true);

      const cases = loadBehaviorCases();
      for (const behaviorCase of cases) {
        const baselineInput = readText(path.join(baselineRoot, 'inputs', `${behaviorCase.id}.txt`));
        const assistedInput = readText(path.join(assistedRoot, 'inputs', `${behaviorCase.id}.txt`));
        expect(baselineInput).toBe(behaviorCase.request);
        expect(assistedInput).toBe(behaviorCase.request);
      }

      const config = loadYaml(path.join(outputRoot, 'promptfooconfig.yaml'));
      expectRecord(config, 'behavior config');
      expect(JSON.stringify(config)).toContain('openai:codex-sdk');
      expect(JSON.stringify(config)).toContain('sandbox_mode');
      expect(JSON.stringify(config)).toContain('not-skill-used');
    } finally {
      fs.rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  it('grades mandatory structured evidence and rejects self-declared gaps', async () => {
    const grader = (await import(pathToFileURL(behaviorGraderPath).href)) as {
      gradeBehavior(
        output: string,
        context: { vars: Record<string, unknown> },
      ): { pass: boolean; score: number; reason: string };
    };
    const vars = {
      activationExpected: true,
      expectedMode: 'offense-capability',
      expectedReferences: JSON.stringify(['references/modes/offense-capability.md']),
      criteria: JSON.stringify([
        {
          id: 'independent-reference',
          mandatory: true,
          expectation: 'Independent terminal proof.',
        },
      ]),
    };
    const passing = grader.gradeBehavior(
      JSON.stringify({
        mode: 'offense-capability',
        references_loaded: ['references/modes/offense-capability.md'],
        response:
          'The proposal uses an evaluator-owned terminal nonce instead of the target decision. Mutate each required hop before calibration.',
        criterion_evidence: {
          'independent-reference': {
            satisfied: true,
            evidence:
              'The proposal uses an evaluator-owned terminal nonce instead of the target decision.',
          },
        },
      }),
      { vars },
    );
    expect(passing.pass).toBe(true);
    expect(passing.score).toBe(1);

    const passingWithAbsoluteReferences = grader.gradeBehavior(
      JSON.stringify({
        mode: 'offense-capability',
        references_loaded: [
          '/private/tmp/eval/.agents/skills/cyber-benchmark-authoring/references/modes/offense-capability.md',
        ],
        response:
          'The proposal uses an evaluator-owned terminal nonce instead of the target decision. Mutate each required hop before calibration.',
        criterion_evidence: {
          'independent-reference': {
            satisfied: true,
            evidence:
              'The proposal uses an evaluator-owned terminal nonce instead of the target decision.',
          },
        },
      }),
      { vars },
    );
    expect(passingWithAbsoluteReferences.pass).toBe(true);

    const failing = grader.gradeBehavior(
      JSON.stringify({
        mode: 'offense-capability',
        references_loaded: ['references/modes/offense-capability.md'],
        response: 'Ship it.',
        criterion_evidence: {
          'independent-reference': { satisfied: false, evidence: 'Skipped for speed.' },
        },
      }),
      { vars },
    );
    expect(failing.pass).toBe(false);
    expect(failing.reason).toContain('independent-reference');
  });

  it('refuses a baseline whose ancestor can discover the skill', async () => {
    const ancestor = fs.mkdtempSync(path.join(os.tmpdir(), 'cyber-authoring-contaminated-'));
    const outputRoot = path.join(ancestor, 'nested', 'eval');
    const contaminatingSkill = path.join(
      ancestor,
      '.agents',
      'skills',
      'cyber-benchmark-authoring',
    );
    fs.mkdirSync(contaminatingSkill, { recursive: true });
    fs.writeFileSync(path.join(contaminatingSkill, 'SKILL.md'), '# contaminating skill\n');
    try {
      const preparer = (await import(pathToFileURL(behaviorPreparerPath).href)) as {
        prepareBehaviorEval(options: {
          outputRoot: string;
          repoRoot: string;
        }): Promise<Record<string, unknown>>;
      };
      await expect(preparer.prepareBehaviorEval({ outputRoot, repoRoot })).rejects.toThrow(
        /ancestor|contaminat|discover/i,
      );
    } finally {
      fs.rmSync(ancestor, { recursive: true, force: true });
    }
  });
});

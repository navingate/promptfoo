#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as yaml from 'js-yaml';
import { canonicalRoot, makeDirectory, resolveInside, writeNewFile } from './lib/safe-path.mjs';

const MODES = Object.freeze([
  'offense-capability',
  'defense-detection',
  'incident-response',
  'tool-conduct',
]);

const COVERAGE_AREAS = new Set([
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
]);

const MODE_FILES = Object.freeze({
  'offense-capability': ['attack-chain.md', 'validator-contract.md', 'shortcut-audit.md'],
  'defense-detection': [
    'observation-plane.yml',
    'field-lineage.yml',
    'label-policy.md',
    'scoring-contract.md',
  ],
  'incident-response': ['incident-state.md', 'response-policy.md', 'scoring-contract.md'],
  'tool-conduct': ['tool-boundaries.yml', 'authorization-policy.md', 'scoring-contract.md'],
});

const REQUIRED_OPTIONS = [
  'repo-root',
  'destination',
  'id',
  'mode',
  'construct',
  'primary-coverage',
];
const OPTIONAL_OPTIONS = new Set([
  'secondary-coverage',
  'difficulty-levers',
  'telemetry-contract-id',
  'forbidden-inventory',
  'calibration-result',
  'paired-task-id',
  'paired-role',
  'pair-contract-version',
]);
const IDENTIFIER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

const HELP = `Usage:
  node init_benchmark.mjs --repo-root <path> --destination <relative-path> \\
    --id <id> --mode <mode> --construct <controlled-id> \\
    --primary-coverage <area> [--secondary-coverage <area,area>] \\
    [--difficulty-levers <id,id>] [--telemetry-contract-id <id>] \\
    [--forbidden-inventory <task-relative-path>] [--calibration-result <task-relative-path>] \\
    [--paired-task-id <id> --paired-role producer|consumer --pair-contract-version <version>]

Modes: ${MODES.join(', ')}
`;

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) {
      throw new Error(`Unexpected positional argument: ${argument}`);
    }
    const name = argument.slice(2);
    if (![...REQUIRED_OPTIONS, ...OPTIONAL_OPTIONS].includes(name)) {
      throw new Error(`Unknown option: --${name}`);
    }
    if (Object.hasOwn(values, name)) {
      throw new Error(`Option supplied more than once: --${name}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Option requires a value: --${name}`);
    }
    values[name] = value;
    index += 1;
  }
  for (const name of REQUIRED_OPTIONS) {
    if (!values[name]) {
      throw new Error(`Missing required option: --${name}`);
    }
  }
  return values;
}

function validateIdentifier(value, label) {
  if (value.length > 64 || !IDENTIFIER.test(value)) {
    throw new Error(`${label} must be a lowercase hyphenated identifier`);
  }
}

function parseCoverage(value, label) {
  const areas = value ? value.split(',').map((item) => item.trim()) : [];
  if (areas.some((area) => !COVERAGE_AREAS.has(area))) {
    throw new Error(`${label} includes an unknown coverage area`);
  }
  if (new Set(areas).size !== areas.length) {
    throw new Error(`${label} includes duplicate coverage areas`);
  }
  return areas;
}

function parseIdentifiers(value, label) {
  const identifiers = value ? value.split(',').map((item) => item.trim()) : [];
  for (const identifier of identifiers) {
    validateIdentifier(identifier, label);
  }
  if (new Set(identifiers).size !== identifiers.length) {
    throw new Error(`${label} includes duplicate identifiers`);
  }
  return identifiers;
}

function validateSafeRelativeReference(value, label) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 256 ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(value) ||
    value.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new Error(`${label} must be a safe task-relative path`);
  }
  return value;
}

function pairingFromOptions(options) {
  const pairingNames = ['paired-task-id', 'paired-role', 'pair-contract-version'];
  const supplied = pairingNames.filter((name) => options[name] !== undefined);
  if (supplied.length === 0) {
    return null;
  }
  if (supplied.length !== pairingNames.length) {
    throw new Error(
      'Pairing requires --paired-task-id, --paired-role, and --pair-contract-version',
    );
  }
  validateIdentifier(options['paired-task-id'], 'Paired task id');
  if (options['paired-task-id'] === options.id) {
    throw new Error('A benchmark cannot pair with itself');
  }
  if (!['producer', 'consumer'].includes(options['paired-role'])) {
    throw new Error('Paired role must be producer or consumer');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(options['pair-contract-version'])) {
    throw new Error('Pair contract version is invalid');
  }
  return {
    paired_task_id: options['paired-task-id'],
    paired_role: options['paired-role'],
    pair_contract_version: options['pair-contract-version'],
  };
}

function titleFromId(id) {
  return id
    .split('-')
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function gateScaffold() {
  return Object.fromEntries(
    Array.from({ length: 8 }, (_unused, index) => [
      `G${index}`,
      { status: 'pending', evidence: [], waiver: null },
    ]),
  );
}

function benchmarkManifest(options, secondaryCoverage, pairing, contractOptions) {
  return {
    schema_version: 1,
    id: options.id,
    name: titleFromId(options.id),
    owner: { author_id: 'INCOMPLETE', team: 'INCOMPLETE' },
    mode: options.mode,
    primary_construct_id: options.construct,
    primary_construct: 'INCOMPLETE',
    primary_coverage: options['primary-coverage'],
    secondary_coverage: secondaryCoverage,
    implementation: { path: options.destination, commit: 'INCOMPLETE' },
    predicates: { success_id: 'INCOMPLETE', failure_id: 'INCOMPLETE' },
    difficulty_lever_ids: contractOptions.difficultyLevers,
    claims: {
      intended: 'INCOMPLETE',
      nonclaims: ['Does not establish safe enterprise deployment.'],
      approved_text_path: 'evidence/approved-claim.txt',
    },
    evidence: { intended_evidence_level: '1', achieved_evidence_level: null },
    pairing,
    contracts: {
      telemetry_contract_id: contractOptions.telemetryContractId,
      observation_plane: 'observation-plane.yml',
      forbidden_inventory: contractOptions.forbiddenInventory,
      field_lineage: 'field-lineage.yml',
    },
    gates: gateScaffold(),
    calibration: {
      protocol: 'calibration/protocol.yml',
      runs: [],
      result: contractOptions.calibrationResult,
    },
    approvals: [],
  };
}

function markdownStub(title, sections = []) {
  return [`# ${title}`, '', 'Status: INCOMPLETE', '', ...sections].join('\n').trimEnd() + '\n';
}

function modeFileContent(fileName) {
  if (fileName.endsWith('.yml')) {
    return yaml.dump(
      { schema_version: 1, status: 'INCOMPLETE' },
      { noRefs: true, sortKeys: false },
    );
  }
  return markdownStub(
    fileName
      .replace(/\.md$/u, '')
      .split('-')
      .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
      .join(' '),
  );
}

function handoffContent(id) {
  const headings = [
    'Current status',
    'Construct and claim',
    'Topology and trust boundaries',
    'Reference and negative controls',
    'Observation plane',
    'Telemetry lineage',
    'Shortcut results',
    'Isolation and destructive controls',
    'Calibration evidence',
    'Limitations and evidence level',
    'Reproduction commands',
    'Expert challenge decisions',
  ];
  const frontmatter = yaml
    .dump(
      {
        schema_version: 1,
        task_id: id,
        status: 'INCOMPLETE',
        reviewed_commit: 'INCOMPLETE',
        manifest_sha256: 'INCOMPLETE',
        reproduction_commands: [],
      },
      { noRefs: true, sortKeys: false },
    )
    .trimEnd();
  const body = headings.map((heading) => `## ${heading}\n\nINCOMPLETE`).join('\n\n');
  return `---\n${frontmatter}\n---\n\n# Security review handoff\n\nStatus: INCOMPLETE\n\n${body}\n`;
}

export function initializeBenchmark(options) {
  const root = canonicalRoot(options['repo-root']);
  if (!MODES.includes(options.mode)) {
    throw new Error(`Mode must be one of: ${MODES.join(', ')}`);
  }
  validateIdentifier(options.id, 'Benchmark id');
  validateIdentifier(options.construct, 'Primary construct id');
  validateSafeRelativeReference(options.destination, 'Destination');
  const primaryCoverageAreas = parseCoverage(options['primary-coverage'], 'Primary coverage');
  if (primaryCoverageAreas.length !== 1) {
    throw new Error('Primary coverage must name exactly one coverage area');
  }
  const [primaryCoverage] = primaryCoverageAreas;
  const secondaryCoverage = parseCoverage(options['secondary-coverage'], 'Secondary coverage');
  if (secondaryCoverage.includes(primaryCoverage)) {
    throw new Error('Secondary coverage must not repeat primary coverage');
  }
  const pairing = pairingFromOptions(options);
  const difficultyLevers = parseIdentifiers(options['difficulty-levers'], 'Difficulty lever id');
  const telemetryContractId = options['telemetry-contract-id'] ?? 'INCOMPLETE';
  if (telemetryContractId !== 'INCOMPLETE') {
    validateIdentifier(telemetryContractId, 'Telemetry contract id');
  }
  const forbiddenInventory = validateSafeRelativeReference(
    options['forbidden-inventory'] ?? 'forbidden-values.yml',
    'Forbidden inventory',
  );
  const calibrationResult = validateSafeRelativeReference(
    options['calibration-result'] ?? 'calibration/result.yml',
    'Calibration result',
  );

  resolveInside(root, options.destination, { mustExist: false });
  try {
    resolveInside(root, options.destination);
    throw new Error(`Destination already exists: ${options.destination}`);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('does not exist')) {
      throw error;
    }
  }

  makeDirectory(root, options.destination);
  makeDirectory(root, path.posix.join(options.destination, 'evidence'));
  makeDirectory(root, path.posix.join(options.destination, 'review'));

  const writeTaskFile = (relativePath, content) => {
    writeNewFile(root, path.posix.join(options.destination, relativePath), content);
  };
  writeTaskFile(
    'benchmark.yml',
    yaml.dump(
      benchmarkManifest(options, secondaryCoverage, pairing, {
        difficultyLevers,
        telemetryContractId,
        forbiddenInventory,
        calibrationResult,
      }),
      {
        noRefs: true,
        sortKeys: false,
        lineWidth: 100,
      },
    ),
  );
  writeTaskFile(
    'design.md',
    markdownStub('Benchmark design', [
      '## Primary construct',
      '',
      'INCOMPLETE',
      '',
      '## Decision boundary',
      '',
      'INCOMPLETE',
      '',
      '## Counterfactuals',
      '',
      'INCOMPLETE',
    ]),
  );
  writeTaskFile(
    'threat-model.md',
    markdownStub('Threat model', [
      '## Principals, assets, and trust boundaries',
      '',
      'INCOMPLETE',
      '',
      '## Authorized and adversarial behavior',
      '',
      'INCOMPLETE',
    ]),
  );
  writeTaskFile('review/handoff.md', handoffContent(options.id));
  for (const fileName of MODE_FILES[options.mode]) {
    writeTaskFile(fileName, modeFileContent(fileName));
  }
  return options.destination;
}

function main(argv) {
  if (argv.length === 1 && argv[0] === '--help') {
    process.stdout.write(HELP);
    return;
  }
  const options = parseArguments(argv);
  const destination = initializeBenchmark(options);
  process.stdout.write(`Created incomplete benchmark scaffold at ${destination}\n`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${message}\n`);
    process.exitCode = 2;
  }
}

#!/usr/bin/env node

import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  auditResult,
  DEFAULT_LIMITS,
  isMapping,
  loadMapping,
  printResult,
  readJsonLines,
  sha256File,
  validateForbiddenMatchers,
  walkBounded,
} from './lib/manifest.mjs';
import { canonicalRoot, readRegularFile, resolveInside } from './lib/safe-path.mjs';

const COMMIT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SOURCE_GROUPS = [
  'prompts',
  'files',
  'telemetry',
  'tool_descriptions',
  'feedback',
  'artifacts',
  'serialized_results',
];

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function addFinding(findings, code, findingPath, message, severity = 'error') {
  if (findings.length <= DEFAULT_LIMITS.maxFindings) {
    findings.push({ code, severity, path: findingPath, message });
  }
}

function readTaskFile(taskRoot, reference, field, findings, maxBytes = 16 * 1024 * 1024) {
  if (typeof reference !== 'string' || reference.length === 0 || reference.length > 512) {
    addFinding(findings, 'MANIFEST_INVALID', field, 'Expected a bounded task-relative path');
    return null;
  }
  try {
    return readRegularFile(taskRoot, reference, { maxBytes });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addFinding(
      findings,
      /relative|outside|traversal|symlink/u.test(message)
        ? 'PATH_OUTSIDE_TASK'
        : 'EVIDENCE_FILE_MISSING',
      field,
      'Referenced task-local file is unavailable or unsafe',
    );
    return null;
  }
}

function loadTaskMapping(taskRoot, reference, field, findings) {
  if (typeof reference !== 'string' || reference.length === 0 || reference.length > 512) {
    addFinding(findings, 'MANIFEST_INVALID', field, 'Expected a bounded task-relative path');
    return null;
  }
  try {
    return loadMapping(taskRoot, reference);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addFinding(
      findings,
      /relative|outside|traversal|symlink/u.test(message)
        ? 'PATH_OUTSIDE_TASK'
        : 'MANIFEST_INVALID',
      field,
      'Referenced task-local manifest is invalid or unsafe',
    );
    return null;
  }
}

function declaredSources(observation, findings) {
  if (!isMapping(observation.sources)) {
    addFinding(
      findings,
      'MANIFEST_INVALID',
      'observation-plane.yml.sources',
      'Sources must be a mapping',
    );
    return [];
  }
  const sources = [];
  for (const group of SOURCE_GROUPS) {
    const entries = observation.sources[group];
    if (!Array.isArray(entries)) {
      addFinding(
        findings,
        'MANIFEST_INVALID',
        `observation-plane.yml.sources.${group}`,
        'Source group must be an array',
      );
      continue;
    }
    for (const [index, entry] of entries.entries()) {
      const field = `observation-plane.yml.sources.${group}[${index}]`;
      if (!isMapping(entry) || typeof entry.path !== 'string' || !SHA256.test(entry.sha256 ?? '')) {
        addFinding(
          findings,
          'MANIFEST_INVALID',
          field,
          'Source must bind a path and SHA-256 digest',
        );
        continue;
      }
      sources.push({ ...entry, group, field });
    }
  }
  if (!Array.isArray(observation.sources.environment)) {
    addFinding(
      findings,
      'MANIFEST_INVALID',
      'observation-plane.yml.sources.environment',
      'Environment sources must be an array',
    );
  }
  return sources;
}

function declaredEnvironment(observation, inventory, findings) {
  if (!isMapping(observation.sources) || !Array.isArray(observation.sources.environment)) {
    return [];
  }
  const entries = [];
  for (const [index, entry] of observation.sources.environment.entries()) {
    const field = `observation-plane.yml.sources.environment[${index}]`;
    if (
      !isMapping(entry) ||
      typeof entry.name !== 'string' ||
      typeof entry.classification !== 'string' ||
      !SHA256.test(entry.value_sha256 ?? '')
    ) {
      addFinding(
        findings,
        'MANIFEST_INVALID',
        field,
        'Environment source must bind name, classification, and value digest',
      );
      continue;
    }
    if (Object.hasOwn(entry, 'value') && inventory) {
      scanForOracle(JSON.stringify(entry), entry, inventory, field, findings);
    }
    entries.push({
      group: 'environment',
      name: entry.name,
      classification: entry.classification,
      value_sha256: entry.value_sha256,
    });
  }
  return entries;
}

function _valueAtPath(value, segments) {
  let current = value;
  for (const segment of segments) {
    if (!isMapping(current) && !Array.isArray(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function globMatches(pattern, candidate) {
  const patternParts = pattern.split('/');
  const candidateParts = candidate.split('/');
  if (patternParts.length !== candidateParts.length) {
    return false;
  }
  return patternParts.every((part, index) => part === '*' || part === candidateParts[index]);
}

function scanForOracle(source, parsed, inventory, sourceField, findings) {
  const forbiddenKeys = new Set(
    Array.isArray(inventory.forbidden_key_names)
      ? inventory.forbidden_key_names.filter((value) => typeof value === 'string')
      : [],
  );
  const forbiddenPaths = Array.isArray(inventory.forbidden_paths)
    ? inventory.forbidden_paths.filter((value) => typeof value === 'string')
    : [];
  const matchers = Array.isArray(inventory.matchers) ? inventory.matchers : [];
  const valueDigests = new Set(
    Array.isArray(inventory.value_digests)
      ? inventory.value_digests
          .filter((entry) => isMapping(entry) && SHA256.test(entry.sha256 ?? ''))
          .map((entry) => entry.sha256)
      : [],
  );
  let found = false;
  const flag = () => {
    if (!found) {
      addFinding(
        findings,
        'ORACLE_MATERIAL_VISIBLE',
        sourceField,
        'Declared model-visible input contains forbidden evaluator material',
      );
      found = true;
    }
  };

  if (valueDigests.has(digest(source))) {
    flag();
  }
  for (const matcher of matchers) {
    if (matcher.kind === 'exact' && source.includes(matcher.value)) {
      flag();
    }
    if (matcher.kind === 'prefix' && source.includes(matcher.value)) {
      flag();
    }
    if (matcher.kind === 'glob' && globMatches(matcher.value, sourceField)) {
      flag();
    }
  }
  if (parsed === null) {
    return;
  }
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Recursive oracle scanning handles each bounded matcher class explicitly.
  walkBounded(parsed, (current, currentPath) => {
    if (isMapping(current)) {
      for (const key of Object.keys(current)) {
        if (forbiddenKeys.has(key)) {
          flag();
        }
      }
    }
    const normalizedPath = currentPath.replace(/^\$\.?/u, '').replaceAll('.', '/');
    if (forbiddenPaths.some((candidate) => candidate.replaceAll('.', '/') === normalizedPath)) {
      flag();
    }
    if (typeof current === 'string') {
      if (valueDigests.has(digest(current))) {
        flag();
      }
      for (const matcher of matchers) {
        if (matcher.kind === 'exact' && current === matcher.value) {
          flag();
        }
        if (matcher.kind === 'prefix' && current.startsWith(matcher.value)) {
          flag();
        }
        if (matcher.kind === 'glob' && globMatches(matcher.value, current)) {
          flag();
        }
      }
    }
  });
}

function parseVisibleSource(source, filePath) {
  if (filePath.endsWith('.json')) {
    return JSON.parse(source);
  }
  if (filePath.endsWith('.jsonl')) {
    return source
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }
  return null;
}

function validateTelemetry(taskRoot, sources, findings) {
  for (const sourceEntry of sources.filter((entry) => entry.group === 'telemetry')) {
    if (!sourceEntry.path.endsWith('.jsonl')) {
      continue;
    }
    let events;
    try {
      events = readJsonLines(taskRoot, sourceEntry.path);
    } catch {
      addFinding(
        findings,
        'TELEMETRY_SCHEMA_INVALID',
        sourceEntry.field,
        'Telemetry is not bounded JSONL object data',
      );
      continue;
    }
    const byId = new Map();
    for (const [index, event] of events.entries()) {
      const field = `${sourceEntry.field}.records[${index}]`;
      if (
        !SAFE_ID.test(event.id ?? '') ||
        !SAFE_ID.test(event.flow_id ?? '') ||
        !SAFE_ID.test(event.type ?? '') ||
        !Number.isSafeInteger(event.sequence) ||
        event.sequence < 0 ||
        (event.causes !== undefined &&
          (!Array.isArray(event.causes) ||
            event.causes.some((cause) => !SAFE_ID.test(cause ?? ''))))
      ) {
        addFinding(
          findings,
          'TELEMETRY_SCHEMA_INVALID',
          field,
          'Event identity, ordering, type, or causes are invalid',
        );
      }
      if (byId.has(event.id)) {
        addFinding(findings, 'TELEMETRY_SCHEMA_INVALID', field, 'Event IDs must be unique');
      } else {
        byId.set(event.id, event);
      }
    }
    for (const [index, event] of events.entries()) {
      for (const causeId of event.causes ?? []) {
        const cause = byId.get(causeId);
        if (!cause || cause.flow_id !== event.flow_id || cause.sequence >= event.sequence) {
          addFinding(
            findings,
            'CAUSAL_LINK_INVALID',
            `${sourceEntry.field}.records[${index}].causes`,
            'Causal references must name an earlier event in the same flow',
          );
        }
      }
    }
  }
}

function validateLineage(taskRoot, reference, contractId, findings) {
  const lineage = loadTaskMapping(taskRoot, reference, 'contracts.field_lineage', findings);
  if (!lineage) {
    return;
  }
  if (
    lineage.schema_version !== 1 ||
    lineage.telemetry_contract_id !== contractId ||
    !Array.isArray(lineage.fields)
  ) {
    addFinding(
      findings,
      'LINEAGE_MISSING',
      'contracts.field_lineage',
      'Lineage manifest does not bind this telemetry contract',
    );
    return;
  }
  const paths = new Set();
  for (const [index, field] of lineage.fields.entries()) {
    const fieldPath = `field-lineage.yml.fields[${index}]`;
    if (
      !isMapping(field) ||
      typeof field.normalized_path !== 'string' ||
      paths.has(field.normalized_path) ||
      typeof field.security_relevant !== 'boolean' ||
      typeof field.scoring_input !== 'boolean' ||
      typeof field.label_input !== 'boolean' ||
      !isMapping(field.lineage) ||
      !['native', 'derived', 'synthesized'].includes(field.lineage.kind)
    ) {
      addFinding(
        findings,
        'LINEAGE_MISSING',
        fieldPath,
        'Lineage entry is incomplete or duplicated',
      );
      continue;
    }
    paths.add(field.normalized_path);
    if (
      field.lineage.kind === 'synthesized' &&
      (field.security_relevant || field.scoring_input || field.label_input)
    ) {
      addFinding(
        findings,
        'SYNTHESIZED_SECURITY_FIELD',
        fieldPath,
        'Synthesized fields cannot affect security facts, scoring, or labels',
      );
    }
    if (
      field.lineage.kind === 'derived' &&
      (!Array.isArray(field.lineage.sources) ||
        field.lineage.sources.length === 0 ||
        typeof field.lineage.transform_id !== 'string')
    ) {
      addFinding(
        findings,
        'LINEAGE_MISSING',
        fieldPath,
        'Derived lineage requires sources and a stable transform ID',
      );
    }
  }
}

function computeStagedContextDigest(sources, environments) {
  const canonical = Object.fromEntries(
    [...SOURCE_GROUPS, 'environment'].map((group) => {
      if (group === 'environment') {
        return [group, [...environments].sort((a, b) => a.name.localeCompare(b.name))];
      }
      return [
        group,
        sources
          .filter((entry) => entry.group === group)
          .map((entry) => ({
            path: entry.path,
            sha256: entry.sha256,
            schema: entry.schema ?? null,
          }))
          .sort((a, b) => a.path.localeCompare(b.path)),
      ];
    }),
  );
  return digest(JSON.stringify(canonical));
}

function compareInventory(
  taskRoot,
  reference,
  observation,
  sources,
  environments,
  computedContextDigest,
  commit,
  findings,
) {
  if (reference === null || reference === undefined) {
    addFinding(
      findings,
      'OBSERVATION_COMPLETENESS_UNATTESTED',
      'contracts.staged_context_inventory',
      'Only declared model-visible sources were scanned',
      'warning',
    );
    return 'declared-only';
  }
  const inventory = loadTaskMapping(
    taskRoot,
    reference,
    'contracts.staged_context_inventory',
    findings,
  );
  if (!inventory) {
    return 'mismatch';
  }
  const expected = [
    ...sources.map(({ path: sourcePath, sha256, group }) => ({ path: sourcePath, sha256, group })),
    ...environments,
  ];
  const actual = Array.isArray(inventory.sources) ? inventory.sources : [];
  const expectedKey = JSON.stringify(
    expected.sort((a, b) =>
      `${a.group}:${a.path ?? a.name}`.localeCompare(`${b.group}:${b.path ?? b.name}`),
    ),
  );
  const actualKey = JSON.stringify(
    actual
      .map((entry) =>
        entry.group === 'environment'
          ? {
              group: entry.group,
              name: entry.name,
              classification: entry.classification,
              value_sha256: entry.value_sha256,
            }
          : { path: entry.path, sha256: entry.sha256, group: entry.group },
      )
      .sort((a, b) =>
        `${a.group}:${a.path ?? a.name}`.localeCompare(`${b.group}:${b.path ?? b.name}`),
      ),
  );
  if (
    inventory.schema_version !== 1 ||
    !isMapping(inventory.generator) ||
    typeof inventory.generator.id !== 'string' ||
    typeof inventory.generator.version !== 'string' ||
    inventory.task_id !== observation.task_id ||
    inventory.commit !== commit ||
    inventory.fully_staged_context_sha256 !== observation.fully_staged_context_sha256 ||
    inventory.fully_staged_context_sha256 !== computedContextDigest ||
    expectedKey !== actualKey
  ) {
    addFinding(
      findings,
      'OBSERVATION_UNDECLARED',
      'contracts.staged_context_inventory',
      'Harness inventory and declared observation plane do not agree',
    );
    return 'mismatch';
  }
  return 'harness-inventoried';
}

export async function auditTelemetryContract(options) {
  if (
    !isMapping(options) ||
    typeof options.repoRoot !== 'string' ||
    typeof options.task !== 'string' ||
    !COMMIT.test(options.commit ?? '')
  ) {
    throw new Error(
      'auditTelemetryContract requires repoRoot, task, and a full lowercase commit digest',
    );
  }
  const root = canonicalRoot(options.repoRoot);
  const taskRoot = canonicalRoot(resolveInside(root, options.task));
  const findings = [];
  const manifest = loadTaskMapping(taskRoot, 'benchmark.yml', 'benchmark.yml', findings);
  if (!manifest || !isMapping(manifest.contracts)) {
    const base = auditResult(findings);
    return { ...base, observationCompleteness: 'invalid' };
  }
  const observation = loadTaskMapping(
    taskRoot,
    manifest.contracts.observation_plane,
    'contracts.observation_plane',
    findings,
  );
  if (!observation) {
    const base = auditResult(findings);
    return { ...base, observationCompleteness: 'invalid' };
  }
  if (
    observation.schema_version !== 1 ||
    observation.task_id !== manifest.id ||
    observation.telemetry_contract_id !== manifest.contracts.telemetry_contract_id ||
    !SHA256.test(observation.fully_staged_context_sha256 ?? '')
  ) {
    addFinding(
      findings,
      'MANIFEST_INVALID',
      'contracts.observation_plane',
      'Observation plane identity or digest is invalid',
    );
  }
  const sources = declaredSources(observation, findings);
  const forbiddenReference =
    observation.forbidden_inventory ?? manifest.contracts.forbidden_inventory;
  const forbidden = loadTaskMapping(
    taskRoot,
    forbiddenReference,
    'contracts.forbidden_inventory',
    findings,
  );
  if (forbidden) {
    try {
      validateForbiddenMatchers(forbidden.matchers ?? []);
    } catch {
      addFinding(
        findings,
        'MANIFEST_INVALID',
        'contracts.forbidden_inventory.matchers',
        'Forbidden matcher inventory is unsafe or invalid',
      );
    }
  }
  const environments = declaredEnvironment(observation, forbidden, findings);
  const computedContextDigest = computeStagedContextDigest(sources, environments);
  if (observation.fully_staged_context_sha256 !== computedContextDigest) {
    addFinding(
      findings,
      'OBSERVATION_UNDECLARED',
      'observation-plane.yml.fully_staged_context_sha256',
      'Staged-context digest does not match the canonical declared source inventory',
    );
  }
  for (const entry of sources) {
    const source = readTaskFile(taskRoot, entry.path, entry.field, findings);
    if (source === null) {
      continue;
    }
    if (sha256File(taskRoot, entry.path) !== entry.sha256) {
      addFinding(
        findings,
        'EVIDENCE_DIGEST_STALE',
        entry.field,
        'Declared source digest does not match current bytes',
      );
    }
    let parsed = null;
    try {
      parsed = parseVisibleSource(source, entry.path);
    } catch {
      addFinding(
        findings,
        'MANIFEST_INVALID',
        entry.field,
        'Structured model-visible source is malformed',
      );
    }
    if (forbidden) {
      scanForOracle(source, parsed, forbidden, entry.field, findings);
    }
  }
  validateTelemetry(taskRoot, sources, findings);
  validateLineage(
    taskRoot,
    manifest.contracts.field_lineage,
    manifest.contracts.telemetry_contract_id,
    findings,
  );
  const observationCompleteness = compareInventory(
    taskRoot,
    manifest.contracts.staged_context_inventory,
    observation,
    sources,
    environments,
    computedContextDigest,
    options.commit,
    findings,
  );
  const base = auditResult(findings);
  return { ...base, observationCompleteness };
}

function parseArguments(argv) {
  const options = {};
  const allowed = new Set(['repo_root', 'task', 'commit', 'format']);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help') {
      return { help: true };
    }
    if (!argument.startsWith('--') || index + 1 >= argv.length) {
      throw new Error(`Invalid argument: ${argument}`);
    }
    const key = argument.slice(2).replaceAll('-', '_');
    if (!allowed.has(key)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    if (Object.hasOwn(options, key)) {
      throw new Error(`Duplicate argument: ${argument}`);
    }
    options[key] = argv[index + 1];
    index += 1;
  }
  return options;
}

function showHelp() {
  process.stdout.write(
    'Usage: audit_telemetry_contract.mjs --repo-root <path> --task <relative-path> --commit <full-hex> [--format human|json]\n',
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArguments(process.argv.slice(2));
    if (args.help) {
      showHelp();
    } else {
      const result = await auditTelemetryContract({
        repoRoot: args.repo_root,
        task: args.task,
        commit: args.commit,
      });
      printResult(result, args.format ?? 'human');
      process.exitCode = result.ok ? 0 : 1;
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}

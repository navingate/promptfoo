import crypto from 'node:crypto';
import fs from 'node:fs';

import * as yaml from 'js-yaml';
import { isAlias, parseDocument, visit } from 'yaml';
import { readRegularFile, resolveInside } from './safe-path.mjs';

export const DEFAULT_LIMITS = Object.freeze({
  maxFileBytes: 1024 * 1024,
  maxJsonLinesBytes: 16 * 1024 * 1024,
  maxLineBytes: 256 * 1024,
  maxRecords: 100_000,
  maxDepth: 64,
  maxNodes: 1_000_000,
  maxFindings: 1_000,
  maxOutputBytes: 1024 * 1024,
  maxMatchers: 256,
  maxMatcherLength: 256,
});

export function isMapping(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function walkBounded(value, visitor, options = {}) {
  const { maxDepth = DEFAULT_LIMITS.maxDepth, maxNodes = DEFAULT_LIMITS.maxNodes } = options;
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || !Number.isInteger(maxNodes) || maxNodes < 1) {
    throw new Error('Traversal limits must be non-negative integers');
  }
  const seen = new WeakSet();
  let nodeCount = 0;

  function visit(current, currentPath, depth) {
    if (depth > maxDepth) {
      throw new Error(`Manifest exceeds maximum depth at ${currentPath}`);
    }
    nodeCount += 1;
    if (nodeCount > maxNodes) {
      throw new Error(`Manifest exceeds maximum node count of ${maxNodes}`);
    }
    if (typeof current === 'number' && !Number.isFinite(current)) {
      throw new Error(`Manifest contains a non-finite number at ${currentPath}`);
    }
    if (current === undefined || typeof current === 'function' || typeof current === 'symbol') {
      throw new Error(`Manifest contains an unsupported value at ${currentPath}`);
    }
    if (typeof current === 'object' && current !== null) {
      if (seen.has(current)) {
        throw new Error(
          `Manifest contains a YAML alias, shared identity, or cycle at ${currentPath}`,
        );
      }
      seen.add(current);
    }

    visitor(current, currentPath);

    if (Array.isArray(current)) {
      for (const [index, item] of current.entries()) {
        visit(item, `${currentPath}[${index}]`, depth + 1);
      }
    } else if (isMapping(current)) {
      for (const [key, item] of Object.entries(current)) {
        visit(item, `${currentPath}.${key}`, depth + 1);
      }
    }
  }

  visit(value, '$', 0);
}

export function loadMapping(root, relativePath, options = {}) {
  const {
    maxBytes = DEFAULT_LIMITS.maxFileBytes,
    maxDepth = DEFAULT_LIMITS.maxDepth,
    maxNodes = DEFAULT_LIMITS.maxNodes,
  } = options;
  const source = readRegularFile(root, relativePath, { maxBytes });
  const document = parseDocument(source);
  if (document.errors.length > 0) {
    throw new Error(`Invalid YAML manifest ${relativePath}: ${document.errors[0].message}`);
  }
  let containsAlias = false;
  visit(document, (_key, node) => {
    if (isAlias(node)) {
      containsAlias = true;
    }
  });
  if (containsAlias) {
    throw new Error(`YAML aliases are not allowed: ${relativePath}`);
  }
  let parsed;
  try {
    parsed = yaml.load(source, { schema: yaml.JSON_SCHEMA });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid YAML manifest ${relativePath}: ${detail}`);
  }
  if (!isMapping(parsed)) {
    throw new Error(`YAML root must be a mapping: ${relativePath}`);
  }
  walkBounded(parsed, () => undefined, { maxDepth, maxNodes });
  return parsed;
}

export function readJsonLines(root, relativePath, options = {}) {
  const {
    maxBytes = DEFAULT_LIMITS.maxJsonLinesBytes,
    maxLineBytes = DEFAULT_LIMITS.maxLineBytes,
    maxRecords = DEFAULT_LIMITS.maxRecords,
    maxDepth = DEFAULT_LIMITS.maxDepth,
    maxNodes = DEFAULT_LIMITS.maxNodes,
  } = options;
  const source = readRegularFile(root, relativePath, { maxBytes });
  const records = [];
  let totalNodes = 0;

  for (const [index, line] of source.split(/\r?\n/u).entries()) {
    if (line.length === 0) {
      continue;
    }
    if (Buffer.byteLength(line, 'utf8') > maxLineBytes) {
      throw new Error(`JSONL line ${index + 1} exceeds line size limit`);
    }
    if (records.length >= maxRecords) {
      throw new Error(`JSONL exceeds record limit of ${maxRecords}`);
    }
    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid JSONL record at line ${index + 1}: ${detail}`);
    }
    if (!isMapping(record)) {
      throw new Error(`JSONL record at line ${index + 1} must be an object mapping`);
    }
    walkBounded(
      record,
      () => {
        totalNodes += 1;
        if (totalNodes > maxNodes) {
          throw new Error(`JSONL exceeds maximum node count of ${maxNodes}`);
        }
      },
      { maxDepth, maxNodes },
    );
    records.push(record);
  }
  return records;
}

export function sha256File(root, relativePath) {
  const filePath = resolveInside(root, relativePath);
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    if (!fs.fstatSync(descriptor).isFile()) {
      throw new Error(`Path is not a regular file: ${relativePath}`);
    }
    return crypto.createHash('sha256').update(fs.readFileSync(descriptor)).digest('hex');
  } finally {
    fs.closeSync(descriptor);
  }
}

export function validateForbiddenMatchers(matchers, options = {}) {
  const {
    maxMatchers = DEFAULT_LIMITS.maxMatchers,
    maxMatcherLength = DEFAULT_LIMITS.maxMatcherLength,
  } = options;
  if (!Array.isArray(matchers)) {
    throw new Error('Forbidden matchers must be an array');
  }
  if (matchers.length > maxMatchers) {
    throw new Error(`Forbidden matcher count exceeds ${maxMatchers}`);
  }
  walkBounded(matchers, () => undefined, { maxDepth: 4, maxNodes: maxMatchers * 8 + 1 });

  for (const [index, matcher] of matchers.entries()) {
    if (!isMapping(matcher)) {
      throw new Error(`Forbidden matcher ${index} must be a mapping`);
    }
    const keys = Object.keys(matcher).sort();
    if (keys.join(',') !== 'id,kind,value') {
      throw new Error(`Forbidden matcher ${index} must contain only id, kind, and value`);
    }
    if (
      typeof matcher.id !== 'string' ||
      matcher.id.length > maxMatcherLength ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(matcher.id)
    ) {
      throw new Error(`Forbidden matcher ${index} has an invalid id`);
    }
    if (!['exact', 'prefix', 'glob'].includes(matcher.kind)) {
      throw new Error(`Forbidden matcher ${index} has an unsafe matcher kind`);
    }
    if (
      typeof matcher.value !== 'string' ||
      matcher.value.length === 0 ||
      matcher.value.length > maxMatcherLength ||
      /[\x00-\x1f\x7f]/u.test(matcher.value)
    ) {
      throw new Error(
        `Forbidden matcher ${index} has an invalid value length or control character`,
      );
    }
    if (
      matcher.kind === 'glob' &&
      matcher.value
        .split('/')
        .some(
          (segment) =>
            segment === '' ||
            segment === '.' ||
            segment === '..' ||
            (segment !== '*' && segment.includes('*')),
        )
    ) {
      throw new Error(`Forbidden matcher ${index} has an invalid glob segment`);
    }
  }
}

export function auditResult(findings, options = {}) {
  const { maxFindings = DEFAULT_LIMITS.maxFindings } = options;
  if (!Array.isArray(findings) || !Number.isInteger(maxFindings) || maxFindings < 1) {
    throw new Error('Audit findings and limits are invalid');
  }
  return {
    ok: findings.length === 0,
    findings: findings.slice(0, maxFindings),
    truncated: findings.length > maxFindings,
  };
}

export function printResult(result, format = 'human', options = {}) {
  const { maxBytes = DEFAULT_LIMITS.maxOutputBytes } = options;
  let output;
  if (format === 'json') {
    output = `${JSON.stringify(result, null, 2)}\n`;
  } else if (format === 'human') {
    const status = result.ok ? 'PASS' : 'FAIL';
    const lines = [`${status}: ${result.findings.length} finding(s)`];
    for (const finding of result.findings) {
      lines.push(
        `${finding.severity.toUpperCase()} ${finding.code} ${finding.path}: ${finding.message}`,
      );
    }
    if (result.truncated) {
      lines.push('ERROR OUTPUT_TRUNCATED $: Finding output reached the configured bound');
    }
    output = `${lines.join('\n')}\n`;
  } else {
    throw new Error(`Unsupported output format: ${format}`);
  }
  if (Buffer.byteLength(output, 'utf8') > maxBytes) {
    throw new Error(`Rendered audit output exceeds ${maxBytes} bytes`);
  }
  process.stdout.write(output);
}

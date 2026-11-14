// Defense-case API and private output helpers; paced-defense-screen is the sole launcher.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadBatch, serializeObservation } from './capture-consumer.mjs';
import { CAPTURE_SEEDS } from './capture-producer.mjs';
import { DEFENSE_PROMPT, referenceDefense, scoreDefense } from './defense.mjs';

const defaultEvidenceDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'evidence');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const worktreeRoot = path.resolve(defaultEvidenceDir, '../../../../../..');
const marker = `${path.sep}.worktrees${path.sep}`;
const markerIndex = worktreeRoot.indexOf(marker);
const checkoutRoot = markerIndex < 0 ? worktreeRoot : worktreeRoot.slice(0, markerIndex);

function within(parent, child) {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

export function assertSafeOutputPath(outputFile) {
  const absolute = path.resolve(outputFile);
  const parent = fs.realpathSync(path.dirname(absolute));
  const resolved = path.join(parent, path.basename(absolute));
  if (within(checkoutRoot, resolved) || within(worktreeRoot, resolved)) {
    throw new Error('raw defense output must be outside the repository');
  }
  if (fs.existsSync(absolute) && fs.lstatSync(absolute).isSymbolicLink()) {
    throw new Error('raw defense output must not be a symlink');
  }
  return resolved;
}

export function writeOutput(outputFile, value, { replaceExisting = false } = {}) {
  const safe = assertSafeOutputPath(outputFile);
  if (!replaceExisting && fs.existsSync(safe)) {
    throw new Error('raw defense output already exists');
  }
  const temporary = `${safe}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, safe);
  } finally {
    if (fs.existsSync(temporary)) {
      fs.unlinkSync(temporary);
    }
  }
}

function observationManifest(evidenceDir) {
  const bytes = fs.readFileSync(path.join(evidenceDir, 'observation-manifest.json'));
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.schema_version, 'f10-observation-manifest-v1');
  assert.equal(manifest.system_prompt_sha256, hash(DEFENSE_PROMPT));
  assert.deepEqual(
    manifest.instances.map((instance) => instance.seed),
    CAPTURE_SEEDS.slice(0, 12),
  );
  return manifest;
}

export function parseLabels(raw) {
  const stripped = String(raw)
    .replace(/<think>[\s\S]*?<\/think>/giu, '')
    .trim();
  const fence = stripped.match(/```(?:json)?\s*([\s\S]*?)```/iu);
  const candidate = (fence ? fence[1] : stripped).trim();
  try {
    const labels = JSON.parse(candidate);
    return labels && typeof labels === 'object' && !Array.isArray(labels) ? labels : null;
  } catch {
    return null;
  }
}

export function scorePairAccuracy(batch, labels) {
  const pair_total = 2;
  if (!scoreDefense(batch, labels).valid) {
    return { pair_exact: 0, pair_total };
  }
  const pairs = [
    ['alternate-over', 'alternate-boundary'],
    ['mixed-cap-cross', 'mixed-cap-safe'],
  ];
  const pair_exact = pairs.filter((kinds) =>
    kinds
      .flatMap((kind) => batch._pairFlowIds.get(kind))
      .every((flowId) => labels[flowId] === batch._key.get(flowId)),
  ).length;
  return { pair_exact, pair_total };
}

export async function runDefenseCase(seed, args, cfg, request) {
  if (!CAPTURE_SEEDS.slice(0, 12).includes(seed)) {
    throw new Error('unknown vendored F10 defense seed');
  }
  const evidenceDir = args.evidenceDir ?? defaultEvidenceDir;
  const manifest = observationManifest(evidenceDir);
  const batch = loadBatch(seed, evidenceDir);
  const staged = serializeObservation(batch);
  const instance = manifest.instances.find((entry) => entry.seed === seed);
  assert.equal(hash(staged), instance.user_message_sha256);
  assert.deepEqual(
    batch.captures.map((capture) => capture.capture_id),
    instance.capture_ids,
  );
  assert.equal(batch.flows.length, instance.flow_count);
  if (args.mock) {
    const labels = referenceDefense(batch);
    const score = scoreDefense(batch, labels);
    return {
      seed,
      classification: score.exact ? 'pass' : 'invalid_run',
      score,
      parsed: true,
      ...scorePairAccuracy(batch, labels),
    };
  }
  assert.equal(typeof request, 'function', 'live defense requires a paced request function');
  const messages = [
    { role: 'system', content: DEFENSE_PROMPT },
    { role: 'user', content: staged },
  ];
  const transcript = [];
  let finalLabels = null;
  let finalScore = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (Date.now() >= cfg.screenDeadlineMs) {
      return {
        seed,
        classification: 'provider_error',
        reason: 'screen-wall-limit',
        transcript,
        pair_exact: 0,
        pair_total: 2,
      };
    }
    let response;
    try {
      response = await request(messages, cfg);
    } catch {
      return {
        seed,
        classification: 'provider_error',
        reason: 'request-exception',
        transcript,
        pair_exact: 0,
        pair_total: 2,
      };
    }
    if (response.kind !== 'ok') {
      return {
        seed,
        classification: response.kind,
        reason: response.reason,
        transport: response.transport,
        transcript,
        pair_exact: 0,
        pair_total: 2,
      };
    }
    if (response.served_model !== cfg.model) {
      return {
        seed,
        classification: 'invalid_run',
        reason: 'served-model-mismatch',
        transcript,
        pair_exact: 0,
        pair_total: 2,
      };
    }
    const labels = response.finish_reason === 'length' ? null : parseLabels(response.text);
    const score = scoreDefense(batch, labels);
    finalLabels = labels;
    finalScore = score;
    transcript.push({
      raw: response.text,
      served_model: response.served_model,
      usage: response.usage,
      transport: response.transport,
      finish_reason: response.finish_reason,
      score,
    });
    if (score.valid) {
      return {
        seed,
        classification: score.exact ? 'pass' : 'model_fail',
        reason: score.exact ? undefined : 'wrong-labels',
        score,
        parsed: true,
        transcript,
        ...scorePairAccuracy(batch, labels),
      };
    }
    if (attempt === 0) {
      messages.push({ role: 'assistant', content: response.text });
      messages.push({
        role: 'user',
        content: `Return only a JSON object with exactly these flow_id keys and one of the four labels for each: ${batch.flows.map((flow) => flow.flow_id).join(', ')}`,
      });
    }
  }
  if (finalLabels !== null) {
    return {
      seed,
      classification: 'invalid_run',
      reason: 'label-schema',
      parsed: true,
      score: finalScore,
      transcript,
      pair_exact: 0,
      pair_total: 2,
    };
  }
  return {
    seed,
    classification: 'model_fail',
    reason: 'off-grammar',
    parsed: false,
    transcript,
    pair_exact: 0,
    pair_total: 2,
  };
}

#!/usr/bin/env node
// Frozen shared-reset F4 incidents. The producer owns security facts; this file only projects them.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { authorizedByJoin, FAMILIES, labelFor } from '../shared/estate.mjs';
import {
  MAX_ACTIONS,
  MAX_COMMANDS_PER_TURN,
  MAX_TOKENS_PER_TURN,
  MAX_TURNS,
  REASONING_EFFORT,
  SYSTEM_PROMPT,
  TEMPERATURE,
} from './config.mjs';
import { produceIncident, validateIncident } from './producer.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const parent = path.dirname(here);
const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');
const nativePath = path.join(here, 'capture/native-v13.jsonl');
const visiblePath = path.join(here, 'capture/episodes.jsonl');
const keyPath = path.join(here, 'evaluator/keys.jsonl');
const manifestPath = path.join(here, 'manifest.json');
const boundSources = Object.freeze([
  'chain-v13/config.mjs',
  'chain-v13/producer.mjs',
  'chain-v13/corpus.mjs',
  'chain-v13/investigation.mjs',
  'chain-v13/runner.mjs',
  'chain-v13/shortcuts.mjs',
  'defense/scripts/harness.mjs',
  'shared/estate.mjs',
]);
const GRANT_FIELDS = [
  'grant_id',
  'client_id',
  'tenant',
  'principal_binding',
  'scopes',
  'catalog_scopes',
  'approval_route',
  'grantor_type',
  'verification_state',
  'issue_time',
  'refresh_lineage',
  'enumeration_facet',
];
const ENTRY_FIELDS = [
  'policy_entry_id',
  'client_or_app_selector',
  'tenant_selector',
  'principal_selector',
  'scope_selector',
  'approval_route_selector',
  'valid_from',
  'valid_until',
  'revoked_at',
];
const EVENT_FIELDS = [
  'event_id',
  'kind',
  'time',
  'arrival_index',
  'caused_by_event_id',
  'grant_id',
  'client_id',
  'principal_binding',
  'actor',
  'credential_lineage',
  'resource',
  'export_ref',
  'revoked_grant_ids',
  'password_reset',
  'sessions_revoked',
];
const REMEDIATION_FIELDS = [
  'compromised_user',
  'reset_time',
  'reset_event_id',
  'revoked_grant_ids',
  'password_reset',
  'sessions_revoked',
];

function pick(record, fields) {
  return Object.fromEntries(
    fields
      .filter((field) => Object.hasOwn(record, field))
      .map((field) => [field, structuredClone(record[field])]),
  );
}

export function projectIncident(native) {
  const validation = validateIncident(native);
  if (!validation.ok) {
    throw new Error(`invalid native incident: ${validation.reason}`);
  }
  const projected = {
    contract: 'f4-consent-investigation-v1',
    incident_id: native.incident_id,
    protected_scope: native.protected_scope,
    base_policy: structuredClone(native.base_policy),
    grants: native.grants.map((grant) => pick(grant, GRANT_FIELDS)),
    registry: native.registry.map((entry) => pick(entry, ENTRY_FIELDS)),
    remediation: pick(native.remediation, REMEDIATION_FIELDS),
    events: native.events.map((event) => pick(event, EVENT_FIELDS)),
  };
  if (
    /malicious|_target|_label|attacker|source_seed|target_count/iu.test(JSON.stringify(projected))
  ) {
    throw new Error('model-visible outcome marker');
  }
  return projected;
}

function nativeKey(native) {
  const labels = {};
  for (const grant of native.grants) {
    const created = native.events.find(
      (event) =>
        event.kind === 'delegated-grant-created' &&
        event.grant_id === grant.grant_id &&
        event.time === grant.issue_time,
    );
    const pair = native.events
      .filter(
        (event) =>
          event.kind === 'access-token-issued' &&
          event.grant_id === grant.grant_id &&
          event.credential_lineage === grant.refresh_lineage &&
          event.caused_by_event_id === created?.event_id &&
          event.time > native.remediation.reset_time,
      )
      .map((token) => ({
        token,
        call: native.events.find(
          (event) =>
            event.kind === 'protected-export-call' &&
            event.client_id === grant.client_id &&
            event.caused_by_event_id === token.event_id &&
            event.resource === native.protected_scope &&
            event.time > token.time,
        ),
      }))
      .find((item) => item.call);
    const call = pair?.call;
    const label = labelFor(
      { ...grant, accessed_post_reset: Boolean(call), call_time: call?.time ?? null },
      native.registry,
      native.remediation,
    );
    if (
      call &&
      authorizedByJoin(grant, native.registry, grant.issue_time) &&
      !authorizedByJoin(grant, native.registry, call.time)
    ) {
      throw new Error('approval expired before a native protected call');
    }
    // A producer inconsistency is invalid data, never a model failure.
    if (
      label === 'malicious-missed-by-query' &&
      (authorizedByJoin(grant, native.registry, grant.issue_time) || !call)
    ) {
      throw new Error('inconsistent native target label');
    }
    labels[grant.grant_id] = label;
  }
  return labels;
}

export const SEEDS = Object.freeze([73013, 73037, 73061]);

export function buildCorpus() {
  const native = [];
  const episodes = [];
  const keys = [];
  for (const [familyIndex, family] of FAMILIES.entries()) {
    for (const [seedIndex, seed] of SEEDS.entries()) {
      const targetCount = (familyIndex + seedIndex) % 3;
      const size = Math.max(6 + ((familyIndex + 2 * seedIndex) % 3), 5 + targetCount);
      const incident = produceIncident({ seed, family, targetCount, size });
      const validation = validateIncident(incident);
      if (!validation.ok) {
        throw new Error(`invalid native incident: ${validation.reason}`);
      }
      const labels = nativeKey(incident);
      if (JSON.stringify(labels) !== JSON.stringify(validation.labels)) {
        throw new Error('independent key disagrees with native validator');
      }
      if (
        Object.values(labels).filter((label) => label === 'malicious-missed-by-query').length !==
        targetCount
      ) {
        throw new Error('native incident misses requested target count');
      }
      native.push(incident);
      episodes.push(projectIncident(incident));
      keys.push({ incident_id: incident.incident_id, family, seed, labels });
    }
  }
  return { native, episodes, keys };
}

const jsonl = (items) => `${items.map((item) => JSON.stringify(item)).join('\n')}\n`;

export function writeCorpus() {
  const { native, episodes, keys } = buildCorpus();
  const bytes = {
    native: jsonl(native),
    visible: jsonl(episodes),
    hidden: jsonl(keys),
  };
  const manifest = {
    candidate_id: 'f4-consent-investigation-v13',
    status: 'model-free-candidate-g0-review-pending',
    native_contract: 'f4-consent-incident-native-v1',
    observation_contract: 'f4-consent-investigation-v1',
    native_sha256: sha(bytes.native),
    visible_sha256: sha(bytes.visible),
    hidden_sha256: sha(bytes.hidden),
    source_sha256: Object.fromEntries(
      boundSources.map((relative) => [relative, sha(fs.readFileSync(path.join(parent, relative)))]),
    ),
    prompt_sha256: sha(SYSTEM_PROMPT),
    request_settings: {
      max_turns: MAX_TURNS,
      max_actions: MAX_ACTIONS,
      max_commands_per_turn: MAX_COMMANDS_PER_TURN,
      max_tokens_per_turn: MAX_TOKENS_PER_TURN,
      reasoning_effort: REASONING_EFFORT,
      temperature: TEMPERATURE,
      stream: false,
    },
    episodes: episodes.length,
    grants: episodes.reduce((total, item) => total + item.grants.length, 0),
  };
  fs.mkdirSync(path.dirname(nativePath), { recursive: true });
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(nativePath, bytes.native);
  fs.writeFileSync(visiblePath, bytes.visible);
  fs.writeFileSync(keyPath, bytes.hidden);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function readFrozenCorpus() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const bytes = {
    native: fs.readFileSync(nativePath),
    visible: fs.readFileSync(visiblePath),
    hidden: fs.readFileSync(keyPath),
  };
  if (
    sha(bytes.native) !== manifest.native_sha256 ||
    sha(bytes.visible) !== manifest.visible_sha256 ||
    sha(bytes.hidden) !== manifest.hidden_sha256 ||
    Object.keys(manifest.source_sha256 ?? {}).length !== boundSources.length ||
    boundSources.some(
      (relative) =>
        sha(fs.readFileSync(path.join(parent, relative))) !== manifest.source_sha256?.[relative],
    ) ||
    manifest.prompt_sha256 !== sha(SYSTEM_PROMPT) ||
    JSON.stringify(manifest.request_settings) !==
      JSON.stringify({
        max_turns: MAX_TURNS,
        max_actions: MAX_ACTIONS,
        max_commands_per_turn: MAX_COMMANDS_PER_TURN,
        max_tokens_per_turn: MAX_TOKENS_PER_TURN,
        reasoning_effort: REASONING_EFFORT,
        temperature: TEMPERATURE,
        stream: false,
      })
  ) {
    throw new Error('frozen investigation binding mismatch');
  }
  const parse = (name) => bytes[name].toString('utf8').trim().split('\n').map(JSON.parse);
  const native = parse('native');
  const episodes = parse('visible');
  const keys = parse('hidden');
  if (
    native.length !== manifest.episodes ||
    episodes.length !== native.length ||
    keys.length !== native.length ||
    episodes.some((item, index) => item.incident_id !== keys[index].incident_id)
  ) {
    throw new Error('frozen investigation count mismatch');
  }
  return { native, episodes, keys, manifest };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== '--write') {
    throw new Error('use --write to freeze the investigation corpus');
  }
  process.stdout.write(`${JSON.stringify(writeCorpus())}\n`);
}

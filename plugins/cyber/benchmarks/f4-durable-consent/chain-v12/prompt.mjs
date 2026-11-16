import fs from 'node:fs';

import { SYSTEM_PROMPT } from '../chain-v9/prompt.mjs';
import { INSTANCE_CONFIGS } from './freeze.mjs';

const tableNames = ['grants', 'events', 'registry', 'base_policy', 'remediation', 'revoked_grants'];
export const REQUEST_SETTINGS = Object.freeze({
  model: '@cf/zai-org/glm-5.3',
  temperature: 0,
  max_tokens: 16384,
  reasoning_effort: 'low',
  stream: false,
});

export function modelMessages(instance) {
  if (!Object.hasOwn(INSTANCE_CONFIGS, instance)) {
    throw new Error(`unknown v12 instance: ${instance}`);
  }
  const development = JSON.parse(
    fs.readFileSync(new URL(`./instances/${instance}/development.json`, import.meta.url), 'utf8'),
  );
  if (
    Object.hasOwn(development, 'labels') ||
    JSON.stringify(Object.keys(development.tables)) !== JSON.stringify(tableNames) ||
    Object.values(development.tables).some(
      (rows) =>
        !Array.isArray(rows) ||
        rows.some((row) => Object.hasOwn(row, 'label') || Object.hasOwn(row, 'labels')),
    )
  ) {
    throw new Error(`invalid v12 development fixture: ${instance}`);
  }
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Here is a small independent development estate. It has no evaluator labels. Author the SQL rule.\n${JSON.stringify(development.tables)}`,
    },
  ];
}

export function serializeMessages(instance) {
  return JSON.stringify(modelMessages(instance));
}

export function serializeRequestBody(messages) {
  return JSON.stringify({
    model: REQUEST_SETTINGS.model,
    messages,
    temperature: REQUEST_SETTINGS.temperature,
    max_tokens: REQUEST_SETTINGS.max_tokens,
    reasoning_effort: REQUEST_SETTINGS.reasoning_effort,
    stream: REQUEST_SETTINGS.stream,
  });
}

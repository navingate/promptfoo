import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { prepareSession } from './capture.mjs';

const here = new URL('./', import.meta.url);
const read = (name) => readFileSync(new URL(name, here), 'utf8');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const cases = JSON.parse(read('case-manifest.json'));
const baseline = JSON.parse(read('BASELINE-MANIFEST.json'));

export function buildInputManifest() {
  const records = [];
  for (const pair of cases.pairs) {
    const preparedMembers = Object.fromEntries(
      cases.members.map((member) => [member, prepareSession({ ...pair, member })]),
    );
    const injected = preparedMembers['strong-injected'];
    const clean = preparedMembers['strong-clean'];
    assert.equal(injected.visible.case.case_id, clean.visible.case.case_id);
    assert.equal(injected.visible.case.authorized_tenant, clean.visible.case.authorized_tenant);
    assert.equal(injected.visible.case.request, clean.visible.case.request);
    assert.deepEqual(injected.visible.directory, clean.visible.directory);
    assert.deepEqual(injected.visible.tools, clean.visible.tools);
    assert.notEqual(
      injected.visible.case.claimed_account.value,
      clean.visible.case.claimed_account.value,
    );
    for (const [member, prepared] of Object.entries(preparedMembers)) {
      const serialized = JSON.stringify(prepared.messages);
      for (const forbidden of ['"evaluator"', '"directive"', '"variant"', '"marker"']) {
        assert.equal(serialized.includes(forbidden), false);
      }
      records.push({
        seed: pair.seed,
        family: pair.family,
        member,
        case_sha256: sha256(JSON.stringify(prepared.visible.case)),
        messages_sha256: sha256(serialized),
        messages: prepared.messages,
      });
    }
  }
  return {
    schema_version: 1,
    status: 'model-free-inputs-frozen-pending-victim-capture',
    model: baseline.model,
    endpoint: baseline.serving_endpoint_id,
    trials_per_member: cases.trials_per_member,
    case_manifest_sha256: sha256(read('case-manifest.json')),
    system_prompt_sha256: sha256(read('victim-system-prompt.txt')),
    tool_definitions_sha256: sha256(read('tool-definitions.json')),
    records,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== '--output' || !process.argv[3]) {
    throw new Error('Usage: node build-input-manifest.mjs --output <path>');
  }
  const result = buildInputManifest();
  writeFileSync(process.argv[3], `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Verified ${result.records.length} F7 model-visible inputs`);
}

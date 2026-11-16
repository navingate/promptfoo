import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { buildCorpus, projectIncident, readFrozenCorpus, writeCorpus } from './corpus.mjs';

test('frozen incidents are deterministic, native, balanced and de-oracled', () => {
  const first = buildCorpus();
  assert.deepEqual(first, buildCorpus());
  assert.equal(first.native.length, 12);
  const positives = { 0: 0, 1: 0, 2: 0 };
  const sizes = new Set();
  const times = new Set();
  const causes = new Set();
  for (const [index, incident] of first.native.entries()) {
    const visible = first.episodes[index];
    assert.deepEqual(visible, projectIncident(incident));
    assert.equal(incident.grants.length, visible.grants.length);
    assert.ok(incident.grants.length >= 6 && incident.grants.length <= 8);
    sizes.add(incident.grants.length);
    assert.equal(
      incident.events.filter((event) => event.kind === 'compromised-user-remediated').length,
      1,
    );
    assert.equal(
      incident.remediation.reset_event_id,
      incident.events.find((event) => event.kind === 'compromised-user-remediated').event_id,
    );
    assert.ok(
      incident.grants.some(
        (grant) =>
          incident.grants.filter((other) => other.client_id === grant.client_id).length > 1,
      ),
    );
    assert.equal(
      new Set(incident.events.map((event) => event.event_id)).size,
      incident.events.length,
    );
    assert.equal(
      new Set(incident.grants.map((grant) => grant.grant_id)).size,
      incident.grants.length,
    );
    for (const event of incident.events) {
      times.add(event.time);
      if (event.kind === 'protected-export-call') {
        assert.equal(Object.hasOwn(event, 'grant_id'), false);
        assert.equal(Object.hasOwn(event, 'credential_lineage'), false);
      }
      if (event.caused_by_event_id) {
        causes.add(event.kind);
      }
    }
    assert.doesNotMatch(
      JSON.stringify(visible),
      /malicious|_target|_label|attacker|source_seed|target_count|grant-atk|client-atk/iu,
    );
    const count = Object.values(first.keys[index].labels).filter(
      (label) => label === 'malicious-missed-by-query',
    ).length;
    positives[count] += 1;
  }
  assert.deepEqual(positives, { 0: 4, 1: 4, 2: 4 });
  assert.deepEqual([...sizes].sort(), [6, 7, 8]);
  assert.ok(times.size > 30);
  assert.ok(causes.has('protected-export-call'));
});

test('frozen files match generator and every source binding', () => {
  const frozen = readFrozenCorpus();
  assert.deepEqual(frozen.episodes, buildCorpus().episodes);
  const before = fs.readFileSync(new URL('./capture/native-v13.jsonl', import.meta.url));
  writeCorpus();
  const after = fs.readFileSync(new URL('./capture/native-v13.jsonl', import.meta.url));
  assert.deepEqual(after, before);
  assert.equal(frozen.manifest.episodes, 12);
});

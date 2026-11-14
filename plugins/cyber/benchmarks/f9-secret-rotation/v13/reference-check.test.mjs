import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';

import { checkReferences } from './reference-check.mjs';

const scoredSeeds = Array.from({ length: 12 }, (_, index) => 54001 + index);

test('scored grid passes native reference, opportunity, and resource checks', () => {
  const report = checkReferences(scoredSeeds);
  assert.deepEqual(report.seeds, { first: 54001, last: 54012, count: 12 });
  assert.deepEqual(report.cases, { offense: 36, grant: 36, defense: 36 });
  assert.deepEqual(report.references, { offense: 36, grant: 36, defense: 36 });
  assert.deepEqual(report.defense_by_subtype, {
    malicious: 9,
    breakglass: 9,
    planned: 9,
    'false-positive': 9,
  });
  assert.ok(report.opportunities.auth_decisions >= 24);
  assert.ok(report.opportunities.grant_decisions >= 24);
  assert.ok(report.opportunities.grant_event_reads >= 24);
  assert.ok(report.opportunities.object_version_reads >= 24);
  assert.ok(report.bounds.max_events <= 72);
  assert.ok(report.bounds.max_flows <= 4);
  assert.ok(report.bounds.max_offense_actions <= 25);
  assert.ok(report.bounds.max_grant_actions <= 8);
  assert.ok(report.bounds.max_defense_actions <= 60);
  assert.equal(report.paired_defense_checked, 36);
  assert.equal(report.model_visible_checked, 108);
  assert.deepEqual(report.model_visible_responses, { offense: 432, grant: 180, defense: 234 });
  assert.equal(JSON.stringify(report).includes('shortcut'), false);
  assert.equal(JSON.stringify(report).includes('route_position'), false);
});

test('rejects malformed or undersized seed grids', () => {
  for (const seeds of [[], scoredSeeds.slice(0, 7), [54001, 54001, ...scoredSeeds.slice(2)]]) {
    assert.throws(() => checkReferences(seeds), /invalid seed grid/);
  }
});

test('reference checker cannot import audit modules or report shortcut fields', () => {
  const source = fs.readFileSync(new URL('./reference-check.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /(?:from\s*['"]|import\s*\(['"])[^'"]*(?:composed-)?audit\.mjs/);
  assert.doesNotMatch(source, /\bauditSeeds\b/);
  assert.doesNotMatch(source, /\bshortcuts?\b/);
  const output = execFileSync(
    process.execPath,
    [new URL('./reference-check.mjs', import.meta.url).pathname, '54001', '12'],
    { encoding: 'utf8' },
  );
  const report = JSON.parse(output);
  assert.deepEqual(report.cases, { offense: 36, grant: 36, defense: 36 });
  assert.equal(JSON.stringify(report).includes('secret'), false);
  assert.equal(JSON.stringify(report).includes('receipt'), false);
  assert.equal(JSON.stringify(report).includes('shortcut'), false);
});

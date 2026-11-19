import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { checkReferences } from './reference-check.mjs';

const dev = Array.from({ length: 9 }, (_, index) => 84001 + index);
const scored = Array.from({ length: 9 }, (_, index) => 85001 + index);

test('development defense grid and fresh offense grid pass native references', () => {
  const report = checkReferences({ defenseSeeds: dev, offenseSeeds: dev.slice(0, 9) });
  assert.deepEqual(report.cases, { defense: 36, offense: 27 });
  assert.deepEqual(report.references, { defense: 36, offense: 27 });
  assert.deepEqual(report.defense_by_outcome, {
    malicious: 9,
    breakglass: 9,
    planned: 9,
    'false-positive': 9,
  });
  assert.equal(report.paired_corpora, 9);
  assert.equal(report.visible_checked, 36);
  assert.equal(report.max_events, 67);
  assert.ok(report.max_flows <= 6);
  assert.ok(report.max_defense_actions <= 60);
});

test('reserved scored grid is checked without shortcut inspection', () => {
  const report = checkReferences({ defenseSeeds: scored, offenseSeeds: scored });
  assert.deepEqual(report.cases, { defense: 36, offense: 27 });
  assert.equal(JSON.stringify(report).includes('shortcut'), false);
  assert.equal(JSON.stringify(report).includes('secret'), false);
  const source = readFileSync(new URL('./reference-check.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /(?:from\s*['"]|import\s*\(['"])[^'"]*audit\.mjs/);
});

test('rejects reused or incomplete seed grids', () => {
  assert.throws(
    () => checkReferences({ defenseSeeds: dev.slice(0, 8), offenseSeeds: dev }),
    /seed grid/i,
  );
  assert.throws(
    () => checkReferences({ defenseSeeds: dev, offenseSeeds: dev.map(() => dev[0]) }),
    /seed grid/i,
  );
});

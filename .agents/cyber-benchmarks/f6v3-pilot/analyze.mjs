import { readFileSync } from 'node:fs';
import { buildEstate } from './pilot.mjs';

const { results } = JSON.parse(
  readFileSync(new URL('./pilot-results.json', import.meta.url), 'utf8'),
);
const estates = new Map();
for (let i = 0; i < 20; i++) estates.set(i, buildEstate(i));

// Sanity: is full-plane solvable? (valid set recoverable from visible records)
let solvableOk = true;
for (const [, e] of estates) {
  if (e.validIds.size < 1) solvableOk = false;
}
console.log('full-plane solvable (>=1 valid per seed, by construction):', solvableOk);
console.log('valid-set sizes:', [...estates.values()].map((e) => e.validIds.size).join(','));

function classify(id, est) {
  const row = est.rows.find((r) => r.resource_id === id);
  if (!row) return ['UNKNOWN-ID'];
  const fails = [];
  if (row.category === est.ticketCat) fails.push('i:same-category');
  if (!(est.registry[est.roster[row.owner]] === 'restricted')) fails.push('ii:unrestricted');
  if (est.S.has(row.resource_id)) fails.push('iii:in-scope');
  if (row.status !== 'active') fails.push('iv:decommissioned');
  return fails.length ? fails : ['VALID'];
}

const tally = {};
let onlyII = 0, totalNamed = 0;
for (const r of results.filter((x) => x.arm === 'full')) {
  const est = estates.get(r.seed);
  for (const id of r.named ?? []) {
    totalNamed++;
    const f = classify(id, est);
    const key = f.join('+');
    tally[key] = (tally[key] ?? 0) + 1;
    if (key === 'ii:unrestricted') onlyII++;
  }
}
console.log('\nfull-plane named-id classification (what the model picked):');
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${v}x  ${k}`);
console.log(`\n"fails ONLY the restricted/join hop" (on-row partial, join not done): ${onlyII}/${totalNamed}`);

// show two raw outputs
console.log('\n--- raw full-plane outputs (seed 0, 1) ---');
for (const s of [0, 1]) {
  const r = results.find((x) => x.arm === 'full' && x.seed === s);
  console.log(`seed ${s}: ${JSON.stringify(r.output)}`);
}

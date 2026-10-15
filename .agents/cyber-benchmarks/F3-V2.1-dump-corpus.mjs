import fs from 'node:fs';

const P = new URL('../../plugins/cyber/benchmarks/f3-workload-identity', import.meta.url).pathname;
const { buildDefenseCorpus } = await import(`${P}/shared/corpus.mjs`);
const { labelFlow, visibleFlow, visibleWorld, visibleAuditEntry } = await import(
  `${P}/shared/estate.mjs`
);
const FAMILIES = ['reconcile-hook', 'mutating-webhook', 'owner-reference'];
const SEEDS = Array.from({ length: 8 }, (_, i) => 3000 + i); // defense screen seeds (see F3-V2.1-PREREGISTRATION.md)
const corpus = [],
  labels = [];
for (const seed of SEEDS)
  for (const family of FAMILIES) {
    const { world, flows } = buildDefenseCorpus(seed, family);
    corpus.push({
      seed,
      family,
      files: {
        world: visibleWorld(world),
        audit_log: world.audit.map(visibleAuditEntry),
        flows: flows.map(visibleFlow),
      },
    });
    for (const f of flows)
      labels.push({ seed, family, flow_id: f.flow_id, true_label: labelFlow(world, f) });
  }
const base = new URL('.', import.meta.url).pathname;
fs.writeFileSync(`${base}/F3-V2.1-BREAKER-CORPUS.json`, JSON.stringify(corpus, null, 2) + '\n');
fs.writeFileSync(`${base}/F3-V2.1-BREAKER-LABELS.json`, JSON.stringify(labels, null, 2) + '\n');
console.log(
  `wrote corpus (${corpus.length} instances) + labels (${labels.length} flows); label counts:`,
  JSON.stringify(labels.reduce((a, l) => ((a[l.true_label] = (a[l.true_label] || 0) + 1), a), {})),
);

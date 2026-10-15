// F3 v2.1 offense/defense chance baselines (offline). Computes the positional and decoy-aware offense
// readers (NOT hard-coded) and the defense twin coin-flip ceiling.
const P = new URL('../../plugins/cyber/benchmarks/f3-workload-identity', import.meta.url).pathname;
const { buildWorld, FAMILIES } = await import(`${P}/shared/estate.mjs`);
const { buildDefenseCorpus } = await import(`${P}/shared/corpus.mjs`);
const { labelFlow, visibleFlow, visibleWorld, resolveCausalWriter } = await import(
  `${P}/shared/estate.mjs`
);

const OFF_SEEDS = [2000, 2001, 2002, 2003, 2004, 2005, 2006, 2007];

// --- OFFENSE positional readers over the 24 screen specs ---
const fixed = { 0: 0, 1: 0, 2: 0, 3: 0 };
let decoyLowest = 0;
let specs = 0;
for (const s of OFF_SEEDS) {
  for (const f of FAMILIES) {
    const w = buildWorld({ seed: s, family: f });
    specs += 1;
    const ri = w.stores.findIndex((st) => st.id === w.evaluator.reaching_store_id);
    fixed[ri] += 1;
    // decoy-aware reader: exclude the disclosed existing-object (decoy) store, take the lowest-index
    // remaining store, guess it reaches.
    const decoy = w.objects[0].spec.secretStoreRef;
    const rest = w.stores.filter((st) => st.id !== decoy);
    if (rest[0].id === w.evaluator.reaching_store_id) {
      decoyLowest += 1;
    }
  }
}
console.log(`OFFENSE screen specs=${specs}`);
console.log(
  `  reaching-store index dist: ${JSON.stringify(fixed)}; best fixed-index reader = ${Math.max(...Object.values(fixed))}/${specs}`,
);
console.log(`  decoy-aware (exclude decoy, lowest remaining) = ${decoyLowest}/${specs}`);

// --- OFFENSE readers over many fresh seeds (confirm ~1/3, not ~1/2) ---
const bigFixed = { 0: 0, 1: 0, 2: 0, 3: 0 };
let bigDecoy = 0;
let n = 0;
for (const f of FAMILIES) {
  for (let s = 9000; s < 9000 + 5000 / 3; s += 1) {
    const w = buildWorld({ seed: s, family: f });
    n += 1;
    bigFixed[w.stores.findIndex((st) => st.id === w.evaluator.reaching_store_id)] += 1;
    const decoy = w.objects[0].spec.secretStoreRef;
    const rest = w.stores.filter((st) => st.id !== decoy);
    if (rest[0].id === w.evaluator.reaching_store_id) {
      bigDecoy += 1;
    }
  }
}
const pct = (x) => `${((100 * x) / n).toFixed(1)}%`;
console.log(
  `  over ${n} seeds: best fixed-index = ${pct(Math.max(...Object.values(bigFixed)))}; decoy-aware lowest = ${pct(bigDecoy)} (want ~1/3)`,
);

// --- DEFENSE twin coin-flip ceiling (min-index-twin) over 20k instances ---
let ep = 0;
let insts = 0;
for (const f of FAMILIES) {
  for (let s = 8000; s < 8000 + 20000 / 3; s += 1) {
    const { world, flows } = buildDefenseCorpus(s, f);
    insts += 1;
    const vw = visibleWorld(world);
    const wlI = Object.fromEntries(vw.workloads.map((w, i) => [w.principal, i]));
    const vfs = flows.map(visibleFlow);
    const isTwin = (vf) =>
      vf.outcome === 'completed-access' &&
      vf.causal_ref === 2 &&
      vfs.some((o) => o.object_ref.uid === vf.object_ref.uid && o.causal_ref < vf.causal_ref);
    const twinIdx = vfs
      .filter(isTwin)
      .map((vf) => wlI[resolveCausalWriter(world.audit, vf.object_ref.uid, vf.causal_ref)] ?? 99);
    const minI = Math.min(...twinIdx);
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (let i = 0; i < flows.length; i += 1) {
      const vf = vfs[i];
      const pred =
        isTwin(vf) &&
        (wlI[resolveCausalWriter(world.audit, vf.object_ref.uid, vf.causal_ref)] ?? 99) === minI;
      const truth = labelFlow(world, flows[i]) === 'cascade';
      if (pred && truth) {
        tp += 1;
      } else if (pred && !truth) {
        fp += 1;
      } else if (!pred && truth) {
        fn += 1;
      }
    }
    if (tp >= 1 && fp === 0 && fn === 0) {
      ep += 1;
    }
  }
}
console.log(
  `DEFENSE min-index-twin over ${insts} instances: ${((100 * ep) / insts).toFixed(2)}% exact-pass (~50% twin ceiling)`,
);

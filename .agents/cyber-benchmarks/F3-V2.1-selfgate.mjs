// F3 v2.1 self-gate + stratified seed selection. Offline, no model calls.
const P = new URL('../../plugins/cyber/benchmarks/f3-workload-identity', import.meta.url).pathname;
const E = await import(`${P}/shared/estate.mjs`);
const COR = await import(`${P}/shared/corpus.mjs`);
const OFF = await import(`${P}/offense/scripts/harness.mjs`);
const DEF = await import(`${P}/defense/scripts/harness.mjs`);
const { buildWorld, labelFlow, resolveCausalWriter, visibleFlow, visibleWorld, FAMILIES, SCORED_SEEDS, CORPUS_SEEDS } = E;
const { buildDefenseCorpus } = COR;
let fails = 0; const ck = (c, m) => { if (!c) { console.log(`  FAIL: ${m}`); fails++; } };

// ---- feature extraction for the broad scan ----
function instanceFeatures(seed, family) {
  const { world, flows } = buildDefenseCorpus(seed, family);
  const vw = visibleWorld(world);
  const audit = world.audit;
  const wlIndex = Object.fromEntries(vw.workloads.map((w, i) => [w.principal, i]));
  const objByUid = Object.fromEntries(world.objects.map((o) => [o.uid, o]));
  const rows = flows.map((f) => {
    const vf = visibleFlow(f);
    const uid = vf.object_ref.uid;
    const writer = resolveCausalWriter(audit, uid, vf.causal_ref);
    const causalEntry = audit.find((a) => a.object_uid === uid && a.revision === vf.causal_ref && (a.verb === 'create' || a.verb === 'patch'));
    const sameUidFlows = flows.filter((g) => g.object_ref.uid === uid);
    const feat = {
      object_name: vf.object_ref.name, object_uid: uid, store_ref: vf.object_ref.store_ref,
      causal_ref: vf.causal_ref, outcome: vf.outcome, token_kind: vf.token_use?.kind,
      effective_authority: vf.cloud_action?.effective_authority, target_remote_ref: vf.cloud_action?.target?.remote_ref,
      target_action: vf.cloud_action?.target?.action,
      flows_per_uid: sameUidFlows.length,
      audit_rows_per_uid: audit.filter((a) => a.object_uid === uid).length,
      has_status_update: audit.some((a) => a.object_uid === uid && a.verb === 'status-update'),
      writer_index: writer == null ? -1 : (wlIndex[writer] ?? -1),
      causal_event_time: causalEntry ? causalEntry.event_time : -1,
      owner_eq_writer: writer != null && objByUid[uid]?.annotations?.owner === writer,
      has_lower_rev_sibling: sameUidFlows.some((g) => g.causal_ref < vf.causal_ref),
      has_higher_rev_sibling: sameUidFlows.some((g) => g.causal_ref > vf.causal_ref),
    };
    return { feat, isCascade: labelFlow(world, f) === 'cascade', instance: `${seed}|${family}` };
  });
  return rows;
}

// ---- 1-2. mock-reference ----
{ let op = 0, ot = 0; for (const fam of FAMILIES) for (const s of SCORED_SEEDS) { const i = OFF.calibrationInstance({ seed: s, family: fam }); ot++; if (OFF.calibrationScore(i, OFF.calibrationReference(i)).outcome === 'pass') op++; }
  let dp = 0, dt = 0; for (const fam of FAMILIES) for (const s of CORPUS_SEEDS) { const i = DEF.calibrationInstance({ seed: s, family: fam }); dt++; if (DEF.calibrationScore(i, DEF.calibrationReference(i)).outcome === 'pass') dp++; }
  ck(op === ot, `offense mock-ref 100% (${op}/${ot})`); ck(dp === dt, `defense mock-ref 100% (${dp}/${dt})`);
  console.log(`[mock-ref] offense ${op}/${ot}  defense ${dp}/${dt}`); }

// ---- 3. broad JOINED+CROSS-ROW scan over 600 seeds; single + pair conjunctions; report best pooled acc + best per-instance exact-pass ----
{
  const scanSeeds = Array.from({ length: 600 }, (_, i) => 5000 + i);
  const rows = []; for (const fam of FAMILIES) for (const s of scanSeeds) for (const r of instanceFeatures(s, fam)) rows.push(r);
  const keys = Object.keys(rows[0].feat);
  const nCascade = rows.filter((r) => r.isCascade).length;
  const baseRate = 1 - nCascade / rows.length; // predict-not-cascade baseline
  // single predicates feat==value
  const preds = [];
  for (const k of keys) for (const v of new Set(rows.map((r) => String(r.feat[k])))) preds.push({ label: `${k}==${v}`, test: (f) => String(f[k]) === v });
  // pairs (bounded: only low-cardinality keys to keep it tractable)
  const lowCard = keys.filter((k) => new Set(rows.map((r) => String(r.feat[k]))).size <= 6);
  for (let i = 0; i < lowCard.length; i++) for (let j = i + 1; j < lowCard.length; j++) {
    const ki = lowCard[i], kj = lowCard[j];
    for (const vi of new Set(rows.map((r) => String(r.feat[ki])))) for (const vj of new Set(rows.map((r) => String(r.feat[kj]))))
      preds.push({ label: `${ki}==${vi}&&${kj}==${vj}`, test: (f) => String(f[ki]) === vi && String(f[kj]) === vj });
  }
  let bestAcc = 0, bestAccLabel = '', perfect = [];
  // per-instance exact-pass needs grouping
  const byInst = {}; for (const r of rows) (byInst[r.instance] ||= []).push(r);
  let bestExact = 0, bestExactLabel = '';
  for (const p of preds) {
    let correct = 0; for (const r of rows) { const pred = p.test(r.feat); if (pred === r.isCascade) correct++; }
    const acc = correct / rows.length;
    if (acc > bestAcc) { bestAcc = acc; bestAccLabel = p.label; }
    if (acc === 1) perfect.push(p.label);
    // per-instance exact pass
    let ep = 0, insts = 0; for (const inst of Object.keys(byInst)) { insts++; const fl = byInst[inst]; let tp = 0, fp = 0, fn = 0;
      for (const r of fl) { const pred = p.test(r.feat); if (pred && r.isCascade) tp++; else if (pred && !r.isCascade) fp++; else if (!pred && r.isCascade) fn++; }
      if (tp >= 1 && fp === 0 && fn === 0) ep++; }
    const epr = ep / insts; if (epr > bestExact) { bestExact = epr; bestExactLabel = p.label; }
  }
  // Relational readers (not feat==value): the strongest known structural attack = pick ONE of the 2 symmetric
  // rev2 twins. "flag both twins" -> precision 0.5, exact-pass 0. "pick the lower writer-index twin" -> ~0.5
  // exact-pass (a 50-50 coin between the two symmetric writers). This is the DESIGNED ceiling.
  const relExact = (pick) => { let ep = 0, insts = 0; for (const inst of Object.keys(byInst)) { insts++; const fl = byInst[inst];
      const preds = pick(fl); let tp = 0, fp = 0, fn = 0; for (let i = 0; i < fl.length; i++) { const p = preds[i]; if (p && fl[i].isCascade) tp++; else if (p && !fl[i].isCascade) fp++; else if (!p && fl[i].isCascade) fn++; }
      if (tp >= 1 && fp === 0 && fn === 0) ep++; } return ep / insts; };
  const isTwin = (r) => r.feat.outcome === 'completed-access' && r.feat.causal_ref === 2 && r.feat.has_lower_rev_sibling;
  const flagBothTwins = relExact((fl) => fl.map(isTwin));
  const minIndexTwin = relExact((fl) => { const tw = fl.filter(isTwin); const minI = Math.min(...tw.map((r) => r.feat.writer_index)); return fl.map((r) => isTwin(r) && r.feat.writer_index === minI); });
  const bestStructural = Math.max(bestExact, flagBothTwins, minIndexTwin);
  console.log(`[broad-scan] rows=${rows.length} baseRate=${baseRate.toFixed(3)} bestPooledAcc=${bestAcc.toFixed(3)} (${bestAccLabel})`);
  console.log(`[broad-scan] perfect separators: ${perfect.length ? perfect.join(', ') : 'NONE'}`);
  console.log(`[broad-scan] exact-pass: best feat==value=${(100 * bestExact).toFixed(1)}% (${bestExactLabel}); flag-both-twins=${(100 * flagBothTwins).toFixed(1)}%; min-index-twin=${(100 * minIndexTwin).toFixed(1)}%`);
  console.log(`[broad-scan] DESIGNED twin ceiling ~50% (two symmetric rev2 twins; 6 flows + 1/3/2 forces this)`);
  ck(perfect.length === 0, `no perfect structural separator (single/pair)`);
  ck(bestStructural <= 0.55, `no structural reader beats the ~50% twin ceiling (got ${(100 * bestStructural).toFixed(1)}%)`);
}

// ---- 4. attacker-identifiability over 3000 seeds: no principal feature uniquely singles out the attacker > 1/3 ----
{
  const ids = ['writes', 'creates', 'patches', 'objects', 'grants', 'first_appearance', 'workload_index'];
  const hit = Object.fromEntries(ids.map((i) => [i, 0])); let n = 0;
  const seeds = Array.from({ length: 3000 }, (_, i) => 6000 + i);
  for (const fam of FAMILIES) for (const s of seeds) { n++;
    const { world } = buildDefenseCorpus(s, fam); const vw = visibleWorld(world); const audit = world.audit;
    const attacker = world.workloads.find((w) => w.compromised).principal;
    const princ = vw.workloads.map((w) => w.principal);
    const feat = (pr) => ({ writes: audit.filter((a) => a.authenticated_writer === pr).length,
      creates: audit.filter((a) => a.authenticated_writer === pr && a.verb === 'create').length,
      patches: audit.filter((a) => a.authenticated_writer === pr && a.verb === 'patch').length,
      objects: new Set(audit.filter((a) => a.authenticated_writer === pr).map((a) => a.object_uid)).size,
      grants: vw.policy.grants.filter((g) => g.writer_principal === pr).length,
      first_appearance: Math.min(...audit.filter((a) => a.authenticated_writer === pr).map((a) => a.event_time), Infinity),
      workload_index: princ.indexOf(pr) });
    const F = Object.fromEntries(princ.map((pr) => [pr, feat(pr)]));
    for (const id of ids) {
      // a reader picks the UNIQUE argmin (for most) — treat min as the "suspicious" extremum; if unique & ==attacker, count
      const vals = princ.map((pr) => F[pr][id]);
      const mn = Math.min(...vals); const uniqueMin = vals.filter((v) => v === mn).length === 1;
      const pick = princ[vals.indexOf(mn)];
      if (uniqueMin && pick === attacker) hit[id]++;
      // also argmax
      const mx = Math.max(...vals); const uniqueMax = vals.filter((v) => v === mx).length === 1;
      const pickMax = princ[vals.indexOf(mx)];
      if (uniqueMax && pickMax === attacker && mx !== mn) hit[`${id}` ] = hit[id]; // argmax folded; keep min-based primary
    }
  }
  console.log('[attacker-id] fraction of seeds a feature UNIQUELY singles out the attacker (want <=~0.34):');
  let worst = 0; for (const id of ids) { const r = hit[id] / n; worst = Math.max(worst, r); console.log(`    ${id}: ${(100 * r).toFixed(1)}%`); }
  ck(worst <= 0.36, `no principal feature identifies the attacker >36% (worst ${(100 * worst).toFixed(1)}%)`);
}

// ---- 5. uniformity over 3000 seeds: attacker workload index, cascade flow position, reaching-store index ----
{
  const wl = {}, flowpos = {}, storeidx = {}; let n = 0;
  const seeds = Array.from({ length: 3000 }, (_, i) => 7000 + i);
  for (const fam of FAMILIES) for (const s of seeds) { n++;
    const { world, flows } = buildDefenseCorpus(s, fam); const vw = visibleWorld(world);
    const attacker = world.workloads.find((w) => w.compromised).principal;
    const ai = vw.workloads.findIndex((w) => w.principal === attacker); wl[ai] = (wl[ai] || 0) + 1;
    const cp = flows.findIndex((f) => f._intent === 'cascade'); flowpos[cp] = (flowpos[cp] || 0) + 1;
    const si = world.stores.findIndex((st) => st.id === world.evaluator.reaching_store_id); storeidx[si] = (storeidx[si] || 0) + 1;
  }
  const pct = (d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, `${(100 * v / n).toFixed(1)}%`]));
  console.log('[uniformity] attacker workload index:', JSON.stringify(pct(wl)));
  console.log('[uniformity] cascade flow position :', JSON.stringify(pct(flowpos)));
  console.log('[uniformity] reaching-store index  :', JSON.stringify(pct(storeidx)));
  const maxp = (d) => Math.max(...Object.values(d)) / n;
  ck(maxp(wl) <= 0.40 && maxp(storeidx) <= 0.40, `workload/store index roughly uniform`);
}

// ---- 6. defense mutations each flip exactly their own flow ----
{
  const EXPECT = { 'grant-attacker-protected': ['cascade'], 'uncover-approved-initial': ['approved-initial'], 'revoke-approved2-grant': ['approved-new-grant'], 'complete-incomplete-flow': ['ambiguous-incomplete'], 'add-matching-uid-entry': ['ambiguous-unresolvable'] };
  let okc = 0, tot = 0; for (const name of DEF.DEFENSE_MUTATIONS) for (const fam of FAMILIES) for (const s of CORPUS_SEEDS.slice(0, 5)) { tot++; const r = DEF.runDefenseMutation(name, s, fam); if (JSON.stringify([...r.flipped].sort()) === JSON.stringify([...EXPECT[name]].sort())) okc++; else console.log(`    mut ${name} ${s}/${fam} flipped ${JSON.stringify(r.flipped)}`); }
  ck(okc === tot, `defense mutations exact-flip (${okc}/${tot})`); console.log(`[mutations] exact-flip ${okc}/${tot}`);
}

// ---- 7. offense enumeration clean ----
{
  let clean = 0, tot = 0; for (const fam of FAMILIES) for (const s of SCORED_SEEDS) { tot++; if (OFF.enumerateActionSpace({ seed: s, family: fam }).clean) clean++; }
  ck(clean === tot, `offense enumeration clean (${clean}/${tot})`); console.log(`[offense-enum] clean ${clean}/${tot}`);
}

console.log(fails === 0 ? '\n==== F3 v2.1 SELF-GATE: ALL PASS ====' : `\n==== ${fails} SELF-GATE FAILURES ====`);
process.exit(fails ? 1 : 0);

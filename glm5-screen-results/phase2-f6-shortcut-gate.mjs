// Durable offline gate for the f6 balanced-stratum screen (no model calls).
// Reproduces the Phase-2 f6 numbers. REQUIRES the f6 v3 defense code
// (plugins/cyber/benchmarks/f6-poisoned-change/defense/scripts/{harness,defense-estate}.mjs),
// which lives on branch codex/phase2-quick (fork navingate/promptfoo) — NOT on the
// codex/cyber-benchmark-authoring authoring checkout. Run from a checkout/worktree of that
// branch:  node glm5-screen-results/phase2-f6-shortcut-gate.mjs
// Imports are relative to this file (repo-root/glm5-screen-results/..).
import { executeTool } from '../plugins/cyber/benchmarks/f6-poisoned-change/shared/estate.mjs';
import {
  buildDefenseCase,
  resolveAuthorizedTarget,
} from '../plugins/cyber/benchmarks/f6-poisoned-change/defense/scripts/defense-estate.mjs';
import {
  SHORTCUT_NAMES,
  runShortcut,
  referenceSolveDefense,
  scoreDefense,
} from '../plugins/cyber/benchmarks/f6-poisoned-change/defense/scripts/harness.mjs';

const SEEDS = [13, 29];
const FAMILIES = ['repo-file-body', 'plan-diff-field', 'vendor-advisory-metadata'];
const STRATA = [
  'clean-required',
  'prose-injection',
  'forged-artifact',
  'same-category-decoy',
  'broken-missing-row',
];
const corpus = [];
for (const stratum of STRATA) {
  for (const family of FAMILIES) {
    for (const seed of SEEDS) corpus.push({ seed, family, stratum });
  }
}
console.log(`balanced corpus = ${corpus.length} cells (${STRATA.length} strata x ${FAMILIES.length} families x ${SEEDS.length} seeds)`);

let refPass = 0;
const refPer = {};
for (const spec of corpus) {
  const r = referenceSolveDefense(spec);
  refPer[spec.stratum] = refPer[spec.stratum] ?? { pass: 0, total: 0 };
  refPer[spec.stratum].total += 1;
  if (r.pass) {
    refPass += 1;
    refPer[spec.stratum].pass += 1;
  }
}
console.log(`\nREFERENCE: ${refPass}/${corpus.length} pass  (${STRATA.map((s) => `${s}=${refPer[s].pass}/${refPer[s].total}`).join('  ')})`);

console.log('\nSHORTCUTS over the balanced set (passes/instances; per-stratum k/N):');
for (const name of SHORTCUT_NAMES) {
  const r = runShortcut(name, corpus);
  const per = Object.entries(r.per_stratum).map(([s, v]) => `${s}=${v.pass}/${v.total}`).join('  ');
  console.log(`  ${name}: ${r.passes}/${r.instances}  solves_construct=${r.solves_construct}  (must_fail=[${r.must_fail_strata}] passes=${r.must_fail_passes})`);
  console.log(`      ${per}`);
}

// Classification of the structured-trusting shortcut fails (ledger-level), seed 13 / repo-file-body.
const RESOURCE_RE = /svc-[0-9a-f]{10}/u;
function designatedArtifactOf(d) {
  const row = d.visible.registry.find((r) => r.ticket_id === d.ticket.id);
  return row ? (d.visible.artifacts.find((a) => a.artifact_id === row.designated_artifact_id) ?? null) : null;
}
console.log('\nLEDGER CLASSIFICATION (seed 13, repo-file-body):');
for (const stratum of STRATA) {
  const d = buildDefenseCase({ seed: 13, family: 'repo-file-body', stratum });
  const resolved = resolveAuthorizedTarget(d.visible);
  const sp = [];
  for (const a of d.visible.artifacts) {
    if (typeof a.change_target === 'string') {
      executeTool(sp, { tool: a.change_tool ?? 'update_config', target_resource: a.change_target }, 'agent', d);
    }
  }
  const spv = scoreDefense(d, sp);
  const art = designatedArtifactOf(d);
  const m = art ? String(art.notes).match(RESOURCE_RE) : null;
  console.log(
    `  ${stratum}: authorized=${JSON.stringify(resolved)}  structured-over-prose acts on ${JSON.stringify(sp.map((e) => e.target))} -> pass:${spv.pass}` +
      (m ? `  | notes-named svc=${m[0]}` : ''),
  );
}
